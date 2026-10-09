// Guesses how far away each part of a photo is, for 3D parallax. Runs Depth Anything V2
// Small (Apache-2.0) on the CPU with ONNX Runtime. The model is downloaded once from a
// pinned revision and checked against its SHA-256 before it is ever loaded.

using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace Livingpanes;

static class Depth {
  const string Revision = "4472b7362082ad9968fee890ca0f1e5aca36b93d";
  public const string ModelUrl =
    $"https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/{Revision}/onnx/model.onnx";
  public const string ModelSha256 = "afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c";
  public const long ModelBytes = 99060839;

  static string ModelFile => Path.Combine(Log.Folder, "models", "depth-anything-v2-small.onnx");

  static readonly float[] mean = [0.485f, 0.456f, 0.406f];
  static readonly float[] std = [0.229f, 0.224f, 0.225f];

  public static async Task<string> EnsureModelAsync(Action<string, double> progress, CancellationToken cancel) {
    if (File.Exists(ModelFile) && new FileInfo(ModelFile).Length == ModelBytes) return ModelFile;
    Directory.CreateDirectory(Path.GetDirectoryName(ModelFile)!);
    var partial = ModelFile + ".part";
    using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
    http.DefaultRequestHeaders.UserAgent.ParseAdd("Livingpanes/1.0");
    using var response = await http.GetAsync(ModelUrl, HttpCompletionOption.ResponseHeadersRead, cancel);
    response.EnsureSuccessStatusCode();
    using (var input = await response.Content.ReadAsStreamAsync(cancel))
    using (var output = File.Create(partial))
    using (var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256)) {
      var buffer = new byte[1 << 16];
      long done = 0;
      int read;
      var lastReport = 0L;
      while ((read = await input.ReadAsync(buffer, cancel)) > 0) {
        done += read;
        if (done > ModelBytes) throw new InvalidDataException("The depth model download is larger than expected.");
        hash.AppendData(buffer, 0, read);
        await output.WriteAsync(buffer.AsMemory(0, read), cancel);
        if (done - lastReport > 1 << 20) {
          lastReport = done;
          progress($"Downloading the depth model ({done / 1048576} of {ModelBytes / 1048576} MB)", 0.85 * done / ModelBytes);
        }
      }
      var digest = Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
      if (digest != ModelSha256) {
        output.Close();
        File.Delete(partial);
        throw new InvalidDataException("The depth model did not match its checksum, so it was not used.");
      }
    }
    File.Move(partial, ModelFile, true);
    return ModelFile;
  }

  /// Writes depth.png next to the image: white is near, black is far.
  public static async Task<string> MakeAsync(string imageFile, Action<string, double> progress, CancellationToken cancel) {
    var model = await EnsureModelAsync(progress, cancel);
    progress("Reading depth from the image", 0.88);
    var output = Path.Combine(Path.GetDirectoryName(imageFile)!, "depth.png");
    await Task.Run(() => Run(model, imageFile, output), cancel);
    progress("Depth ready", 1);
    return output;
  }

  static void Run(string model, string imageFile, string output) {
    using var source = Image.FromFile(imageFile);
    // The model wants sides that are multiples of 14, the short side near 518.
    var scale = 518.0 / Math.Min(source.Width, source.Height);
    int Fit(int side) => Math.Clamp((int)Math.Round(side * scale / 14) * 14, 14, 1036);
    int width = Fit(source.Width), height = Fit(source.Height);

    var tensor = new DenseTensor<float>([1, 3, height, width]);
    using (var resized = new Bitmap(width, height, PixelFormat.Format24bppRgb)) {
      using (var g = Graphics.FromImage(resized)) {
        g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
        g.DrawImage(source, 0, 0, width, height);
      }
      var data = resized.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
      try {
        var row = new byte[data.Stride];
        for (var y = 0; y < height; y++) {
          Marshal.Copy(data.Scan0 + y * data.Stride, row, 0, data.Stride);
          for (var x = 0; x < width; x++) {
            // Bitmaps store blue, green, red.
            tensor[0, 0, y, x] = (row[x * 3 + 2] / 255f - mean[0]) / std[0];
            tensor[0, 1, y, x] = (row[x * 3 + 1] / 255f - mean[1]) / std[1];
            tensor[0, 2, y, x] = (row[x * 3] / 255f - mean[2]) / std[2];
          }
        }
      } finally {
        resized.UnlockBits(data);
      }
    }

    using var options = new SessionOptions { GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL };
    using var session = new InferenceSession(model, options);
    var name = session.InputMetadata.Keys.First();
    using var results = session.Run([NamedOnnxValue.CreateFromTensor(name, tensor)]);
    var depth = results.First().AsTensor<float>();
    var dims = depth.Dimensions.ToArray();
    int outHeight = dims[^2], outWidth = dims[^1];

    float min = float.MaxValue, max = float.MinValue;
    foreach (var value in depth) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    var range = Math.Max(1e-6f, max - min);

    using var map = new Bitmap(outWidth, outHeight, PixelFormat.Format24bppRgb);
    var bits = map.LockBits(new Rectangle(0, 0, outWidth, outHeight), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
    try {
      var row = new byte[bits.Stride];
      for (var y = 0; y < outHeight; y++) {
        for (var x = 0; x < outWidth; x++) {
          var value = dims.Length == 4 ? depth[0, 0, y, x] : depth[0, y, x];
          var shade = (byte)Math.Clamp((value - min) / range * 255, 0, 255);
          row[x * 3] = row[x * 3 + 1] = row[x * 3 + 2] = shade;
        }
        Marshal.Copy(row, 0, bits.Scan0 + y * bits.Stride, bits.Stride);
      }
    } finally {
      map.UnlockBits(bits);
    }

    // Back to the photo's shape, at up to 2048 pixels; the engine samples it smoothly.
    var fit = Math.Min(1.0, 2048.0 / Math.Max(source.Width, source.Height));
    using var final = new Bitmap(Math.Max(1, (int)(source.Width * fit)), Math.Max(1, (int)(source.Height * fit)));
    using (var g = Graphics.FromImage(final)) {
      g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
      g.DrawImage(map, 0, 0, final.Width, final.Height);
    }
    final.Save(output, ImageFormat.Png);
  }
}
