# Release media tools — 0.1.0-beta.1

FFmpeg 7.1.5 (LGPL-2.1-or-later), Opus 1.5.2 (BSD), whisper.cpp commit d1be6fde11ac6e0407606b4e42fe72d34add8037 (MIT). Upstream source archives are attached in the same GitHub Release as media-sources.tar.gz, with SHA256SUMS. Source code was not modified. FFmpeg is a separate executable invoked by IPC/stdio, not a library linked into the Electron application. No nonfree/GPL components were enabled in this release FFmpeg build. Developer-only FFmpeg from imageio is not distributed.

Official sources:
- https://ffmpeg.org/releases/ffmpeg-7.1.5.tar.xz
- https://downloads.xiph.org/releases/opus/opus-1.5.2.tar.gz
- https://github.com/ggml-org/whisper.cpp/archive/d1be6fde11ac6e0407606b4e42fe72d34add8037.tar.gz
- https://ffmpeg.org/legal.html

Build environment: macOS arm64, Apple clang / Xcode SDK 26.5, CMake 4.4.4. Deployment target 14.0. pkgconf 2.3.0 is build-only (https://distfiles.ariadne.space/pkgconf/pkgconf-2.3.0.tar.xz). Verify source archive hashes using packaging/media-sources.sha256.

Build Opus with `./configure --prefix=/tmp/wechat-signals-media-deps --disable-shared --enable-static --disable-extra-programs CFLAGS="-O2 -mmacosx-version-min=14.0"`, then `make -j6 && make install`. Install pkgconf to the same prefix. Set PKG_CONFIG_PATH=/tmp/wechat-signals-media-deps/lib/pkgconfig for FFmpeg configuration. Run `make -j6` after the following configure flags:

```text
ffmpeg version 7.1.5 Copyright (c) 2000-2026 the FFmpeg developers
  built with Apple clang version 21.0.0 (clang-2100.1.1.101)
  configuration: --prefix=/tmp/wechat-signals-media-deps/ffmpeg-install --pkg-config=/tmp/wechat-signals-media-deps/bin/pkgconf --pkg-config-flags=--static --disable-autodetect --disable-gpl --disable-nonfree --disable-network --disable-doc --disable-debug --disable-shared --enable-static --disable-everything --enable-ffmpeg --enable-protocol='file,pipe' --enable-demuxer='ogg,wav,mp3,flac,hevc,pcm_s16le,image2,image2pipe' --enable-decoder='opus,vorbis,mp3,flac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,hevc,png,mjpeg' --enable-parser='opus,vorbis,mpegaudio,flac,hevc,png' --enable-encoder='libopus,pcm_s16le,png,gif' --enable-muxer='ogg,wav,image2,image2pipe,gif' --enable-filter='aresample,aformat,anull,null,format,scale,split,palettegen,paletteuse' --enable-libopus --enable-zlib --extra-cflags='-O2 -mmacosx-version-min=14.0' --extra-ldflags='-mmacosx-version-min=14.0'
  libavutil      59. 39.100 / 59. 39.100
  libavcodec     61. 19.101 / 61. 19.101
  libavformat    61.  7.103 / 61.  7.103
  libavdevice    61.  3.100 / 61.  3.100
  libavfilter    10.  5.100 / 10.  5.100
  libswscale      8.  3.100 /  8.  3.100
  libswresample   5.  3.100 /  5.  3.100

  configuration:
    --prefix=/tmp/wechat-signals-media-deps/ffmpeg-install
    --pkg-config=/tmp/wechat-signals-media-deps/bin/pkgconf
    --pkg-config-flags=--static
    --disable-autodetect
    --disable-gpl
    --disable-nonfree
    --disable-network
    --disable-doc
    --disable-debug
    --disable-shared
    --enable-static
    --disable-everything
    --enable-ffmpeg
    --enable-protocol='file,pipe'
    --enable-demuxer='ogg,wav,mp3,flac,hevc,pcm_s16le,image2,image2pipe'
    --enable-decoder='opus,vorbis,mp3,flac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,hevc,png,mjpeg'
    --enable-parser='opus,vorbis,mpegaudio,flac,hevc,png'
    --enable-encoder='libopus,pcm_s16le,png,gif'
    --enable-muxer='ogg,wav,image2,image2pipe,gif'
    --enable-filter='aresample,aformat,anull,null,format,scale,split,palettegen,paletteuse'
    --enable-libopus
    --enable-zlib
    --extra-cflags='-O2 -mmacosx-version-min=14.0'
    --extra-ldflags='-mmacosx-version-min=14.0'

```

For whisper.cpp: `cmake -S SOURCE -B BUILD -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 -DCMAKE_OSX_ARCHITECTURES=arm64 -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_CURL=OFF`, then `cmake --build BUILD --target whisper-cli -j6`. Both C and C++ used -ffile-prefix-map to remove the local home path. No extra runtime dylibs; only macOS frameworks/libraries. Embedded Metal kernels remove external runtime shader-source dependencies.

Multilingual Whisper base/small q5_1 weights are unmodified local speech models from ggerganov/whisper.cpp on Hugging Face; original Whisper is MIT (https://github.com/openai/whisper). Original license and model hashes are retained. Models never act as the Jev relationship judge. macOS signature metadata is added after compilation. Rebuild or replace the independent FFmpeg executable in Contents/Resources/app/vendor/speech/ffmpeg as desired; modifying a bundle invalidates its signature and requires re-signing your own copy.
