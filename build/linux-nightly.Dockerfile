FROM oven/bun:1.4.3 AS bun
FROM rust:1-bookworm
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends build-essential pkg-config curl wget file ca-certificates libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf libssl-dev libdbus-1-dev libsecret-1-dev rpm xdg-utils libfuse2 && rm -rf /var/lib/apt/lists/*
ENV CARGO_BUILD_JOBS=4 APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1
WORKDIR /app
COPY . .
CMD ["sh","-c","bun install --frozen-lockfile --ignore-scripts && bun run dist"]
