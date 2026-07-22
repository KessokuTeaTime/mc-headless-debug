ARG JAVA_VERSION=25
FROM eclipse-temurin:${JAVA_VERSION}-jdk-noble
ARG TARGETARCH

RUN --mount=type=cache,id=mchd-apt-archives-${TARGETARCH},target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=mchd-apt-lists-${TARGETARCH},target=/var/lib/apt,sharing=locked \
    if [ "$TARGETARCH" = amd64 ]; then \
        apt_uri=http://archive.ubuntu.com/ubuntu; \
    else \
        apt_uri=http://ports.ubuntu.com/ubuntu-ports; \
    fi; \
    printf '%s\n' \
        'Types: deb' \
        "URIs: $apt_uri" \
        'Suites: noble noble-updates' \
        'Components: main universe restricted multiverse' \
        'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' \
        > /etc/apt/sources.list.d/ubuntu.sources \
    && for attempt in 1 2 3 4 5 6 7 8 9 10; do \
        apt-get -o Acquire::Retries=5 update && break; \
        test "$attempt" -lt 10 || exit 1; \
        sleep 5; \
    done \
    && for attempt in 1 2 3 4 5 6 7 8 9 10; do \
        DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=5 --fix-broken install -y --fix-missing \
        || true; \
        DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=5 install -y --fix-missing --no-install-recommends \
            libgl1-mesa-dri \
            libglx-mesa0 \
            libopenal1 \
            socat \
            xvfb \
        && break; \
        test "$attempt" -lt 10 || exit 1; \
        sleep 5; \
    done

COPY entrypoint.sh /usr/local/bin/mchd-entrypoint
RUN chmod 0755 /usr/local/bin/mchd-entrypoint

ENTRYPOINT ["/usr/local/bin/mchd-entrypoint"]
