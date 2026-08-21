#!/bin/sh
# Sourced by the official nginx docker-entrypoint.
# Generate a self-signed cert on first start so the panel (and noVNC console)
# can be served over HTTPS for browsers that require a secure context.
CERT_DIR="/etc/nginx/certs"
if [ ! -f "$CERT_DIR/panel.crt" ]; then
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$CERT_DIR/panel.key" -out "$CERT_DIR/panel.crt" \
    -days 825 -subj "/CN=panel.local" \
    -addext "subjectAltName=DNS:panel.local,DNS:localhost,IP:127.0.0.1" >/dev/null 2>&1 \
    && echo "panel: generated self-signed TLS cert" \
    || echo "panel: WARNING - cert generation failed, HTTPS will not start"
fi
