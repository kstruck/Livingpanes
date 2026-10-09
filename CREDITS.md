# Credits

## Deskworlds, by Chase Lean

Livingpanes exists because of [Deskworlds](https://github.com/chaseleantj/deskworlds) by
[Chase Lean](https://github.com/chaseleantj). Deskworlds is the original living
wallpaper: Riverbed, Coral reef, Betta, Plasma globe, Koi pond and Bonfire are Chase's
work, along with the frame loop, render policy, gallery and the macOS app. Chase shared
it under the MIT license, and this project keeps his copyright notice, his code, and the
full commit history, so every one of his commits is still credited to him.

If you enjoy Livingpanes, please star the original:
**https://github.com/chaseleantj/deskworlds**

Upstream contributors whose commits are part of this history: Chase Lean, Jeremy Day,
Michael Warf and Tanner Bennett. Thank you.

## What Livingpanes adds

- The Windows 11 host (`windows/`)
- The Studio and its scene engine (`studio/`, `scenes/studio/`)
- Pets, tap the glass, food at the cursor and clock lighting (`scenes/shared/extras.js`)

## Third-party software and models

| Component | License | Use |
| --- | --- | --- |
| [three.js](https://threejs.org) | MIT | 3D rendering, bundled in `vendor/` |
| [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) | Microsoft license (runtime ships with Windows 11) | shows the scenes on Windows |
| [ONNX Runtime](https://onnxruntime.ai) | MIT | runs the depth model on the CPU |
| [Depth Anything V2 Small](https://huggingface.co/depth-anything/Depth-Anything-V2-Small) (ONNX export by [onnx-community](https://huggingface.co/onnx-community/depth-anything-v2-small)) | Apache-2.0 | 3D parallax from a photo; downloaded on first use, never bundled |
| [Anthropic C# SDK](https://github.com/anthropics/anthropic-sdk-csharp) | MIT | "Describe a scene" (uses your own API key) |

The original reddit post that started this:
[I asked Opus 5.5 to generate an extremely…](https://www.reddit.com/r/ClaudeAI/comments/1x02pno/i_asked_opus_55_to_generate_an_extremely/)
on r/ClaudeAI.
