# Local speech dependencies

whisper.cpp source: https://github.com/ggml-org/whisper.cpp
Build commit: d1be6fde11ac6e0407606b4e42fe72d34add8037, Apple Silicon, embedded Metal kernels, static ggml; MIT license in WHISPER_LICENSE. Built using CMake 4.4.4 and Apple clang.

Multilingual Whisper small q5_1 weights: https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin
Whisper model: https://github.com/openai/whisper (MIT). This is local speech recognition; it is not an OpenAI API call and does not replace TypeSafe Jev analysis.

FFmpeg 7.1 macOS arm64 binary obtained from the imageio-ffmpeg 0.6.0 PyPI wheel. Its build enables GPL components; GNU GPL v2 or later applies. Source and dependency build information: https://github.com/imageio/imageio-ffmpeg and https://github.com/imageio/imageio-ffmpeg/tree/v0.6.0/binaries
FFmpeg upstream source: https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz
Full binary license/configuration is available with ffmpeg -L. This is a local development bundle, not a signed distribution package; establish a corresponding-source distribution before publicly redistributing it.

Fast mode uses multilingual Whisper base q5_1 weights from the same official model-download script and MIT model source: https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin. Precise mode keeps small q5_1. Base is faster but may be less accurate; no external speech API is called.
