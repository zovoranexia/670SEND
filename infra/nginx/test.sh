#!/usr/bin/env bash
# 670Send — test the Nginx configuration WITHOUT a server: starts Nginx in a throw-away container with the real
# config files, self-signed certificates and stub back-ends on 3100/4010, then checks routing, headers and limits.
#
#   infra/nginx/test.sh            (needs Docker; takes ~30 s)
#
# It proves the syntax and the behaviour that matters (redirects, SPA fallback, cache rules, security headers,
# forged X-Forwarded-For, 405 on writes, unknown hosts). It does NOT prove real certificates or real DNS.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WIN_ROOT=$(cd "$ROOT" && (pwd -W 2>/dev/null || pwd))
NAME=670send-nginx-test-$$
export MSYS_NO_PATHCONV=1
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  \e[32m✓\e[0m %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  \e[31m✗\e[0m %s\n' "$1"; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" -v "$WIN_ROOT/infra/nginx:/cfg:ro" nginx:stable-alpine sleep 3600 >/dev/null
dx() { docker exec "$NAME" sh -c "$1"; }
dx 'apk add --no-cache curl openssl >/dev/null 2>&1'

# ---- lay the files out like the server does ----------------------------------------------------------------------
dx '
mkdir -p /etc/nginx/snippets/670send /etc/nginx/sites-enabled /srv/670send/current/pwa/assets /srv/670send/current/pwa/icons /srv/670send/current/admin/assets /var/www/certbot/.well-known/acme-challenge
sed -e "s/^user www-data;/user nginx;/" /cfg/nginx.conf > /etc/nginx/nginx.conf
cp /cfg/snippets/*.conf /etc/nginx/snippets/670send/
for f in 670send.tl app.670send.tl admin.670send.tl api.670send.tl; do cp /cfg/sites/$f.conf /etc/nginx/sites-enabled/$f.conf; done
for h in 670send.tl app.670send.tl admin.670send.tl api.670send.tl; do
  mkdir -p /etc/letsencrypt/live/$h
  openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=$h" -addext "subjectAltName=DNS:$h,DNS:www.670send.tl" \
    -keyout /etc/letsencrypt/live/$h/privkey.pem -out /etc/letsencrypt/live/$h/fullchain.pem 2>/dev/null
done
echo "<!doctype html><title>pwa</title>" > /srv/670send/current/pwa/index.html
echo "// sw" > /srv/670send/current/pwa/sw.js
echo "{}" > /srv/670send/current/pwa/manifest.webmanifest
echo "console.log(1)" > /srv/670send/current/pwa/assets/index-abc123.js
echo "<!doctype html><title>admin</title>" > /srv/670send/current/admin/index.html
echo "console.log(2)" > /srv/670send/current/admin/assets/index-def456.js
echo "token-ok" > /var/www/certbot/.well-known/acme-challenge/probe
# stand-ins for the two containers; they echo what Nginx forwarded
cat > /etc/nginx/sites-enabled/zz-stubs.conf <<EOF
server { listen 127.0.0.1:3100; location / { return 200 "web xff=\$http_x_forwarded_for host=\$host"; } }
server { listen 127.0.0.1:4010; location / { return 200 "api xff=\$http_x_forwarded_for proto=\$http_x_forwarded_proto"; } }
EOF
' || { echo "layout failed"; exit 1; }

echo "== nginx -t"
if dx 'nginx -t' 2>&1 | tee /dev/stderr | grep -q "test is successful"; then ok "configuration syntax is valid"; else bad "nginx -t failed"; docker logs "$NAME" 2>&1 | tail -5; exit 1; fi
dx 'nginx' >/dev/null 2>&1 || true
sleep 1

# curl against a host name on 127.0.0.1
c()   { dx "curl -sk -o /dev/null -w '%{http_code}' --resolve $1:443:127.0.0.1 --resolve $1:80:127.0.0.1 ${*:2}"; }
hdr() { dx "curl -skI --resolve $1:443:127.0.0.1 https://$1$2" | tr -d '\r'; }
body(){ dx "curl -sk --resolve $1:443:127.0.0.1 ${*:3} https://$1$2"; }
has() { grep -qi "$2" <<<"$1"; }

echo "== redirects and ACME"
[[ $(c 670send.tl http://670send.tl/page) == 301 ]] && ok "http → https redirect" || bad "http redirect"
[[ $(c www.670send.tl https://www.670send.tl/x) == 301 ]] && ok "www → apex redirect" || bad "www redirect"
[[ $(dx "curl -s --resolve app.670send.tl:80:127.0.0.1 http://app.670send.tl/.well-known/acme-challenge/probe") == token-ok ]] && ok "ACME challenge served over plain http" || bad "ACME challenge"

echo "== public site (proxy to web)"
out=$(body 670send.tl / -H 'X-Forwarded-For: 6.6.6.6')
has "$out" "xff=127.0.0.1" && ok "forged X-Forwarded-For is overwritten with the real peer" || bad "X-Forwarded-For not overwritten: $out"
[[ $(c 670send.tl -X POST https://670send.tl/) == 405 ]] && ok "POST to the website is refused at the edge" || bad "POST allowed on web"

echo "== field app (static + SPA)"
h=$(hdr app.670send.tl /)
has "$h" "content-security-policy:.*connect-src 'self' https://api.670send.tl" && ok "PWA CSP present" || bad "PWA CSP missing"
has "$h" "strict-transport-security" && ok "HSTS present" || bad "HSTS missing"
has "$h" "permissions-policy:.*camera=(self)" && ok "camera allowed for the app only" || bad "PWA permissions-policy"
[[ $(c app.670send.tl https://app.670send.tl/some/client/route) == 200 ]] && ok "SPA fallback serves index.html" || bad "SPA fallback"
[[ $(c app.670send.tl https://app.670send.tl/missing.js) == 404 ]] && ok "a missing file is a real 404" || bad "missing file not 404"
has "$(hdr app.670send.tl /sw.js)" "cache-control: no-cache" && ok "service worker is never cached" || bad "sw.js cache header"
has "$(hdr app.670send.tl /assets/index-abc123.js)" "cache-control: public, max-age=31536000, immutable" && ok "fingerprinted assets are immutable" || bad "asset cache header"
has "$(hdr app.670send.tl /assets/index-abc123.js)" "content-security-policy" && ok "CSP survives the cache location (add_header inheritance)" || bad "CSP lost in /assets/"
has "$(hdr app.670send.tl /manifest.webmanifest)" "application/manifest+json" && ok "manifest content type" || bad "manifest type"

echo "== admin console"
h=$(hdr admin.670send.tl /)
has "$h" "x-robots-tag: noindex" && ok "admin is not indexable" || bad "admin robots header"
has "$h" "referrer-policy: no-referrer" && ok "admin sends no referrer" || bad "admin referrer"
has "$h" "img-src 'self' data: blob: https://\*.r2.cloudflarestorage.com" && ok "admin CSP allows the photo storage host" || bad "admin CSP img-src"
has "$h" "camera=()" && ok "admin has no camera permission" || bad "admin permissions-policy"
[[ $(c admin.670send.tl https://admin.670send.tl/users/42) == 200 ]] && ok "admin SPA fallback" || bad "admin SPA fallback"

echo "== API"
out=$(body api.670send.tl /v1/health "-H 'X-Forwarded-For: 6.6.6.6'")
has "$out" "xff=127.0.0.1" && has "$out" "proto=https" && ok "API gets the real client IP and the https scheme" || bad "API forwarding wrong: $out"
[[ $(c api.670send.tl https://api.670send.tl/) == 404 ]] && ok "bare API root is a 404 from the edge" || bad "api root"
[[ $(c api.670send.tl https://api.670send.tl/admin) == 404 ]] && ok "only /v1 is proxied" || bad "non-/v1 path proxied"
has "$(hdr api.670send.tl /v1/health)" "x-robots-tag: noindex" && ok "API headers present" || bad "API headers"
codes=""
for _ in $(seq 1 14); do codes="$codes $(c api.670send.tl -X POST https://api.670send.tl/v1/auth/login)"; done
has "$codes" 429 && ok "sign-in is rate limited per IP (429 after the burst)" || bad "login not rate limited: $codes"
big=$(dx "head -c 4000000 /dev/zero | curl -sk -o /dev/null -w '%{http_code}' --resolve api.670send.tl:443:127.0.0.1 -X PUT --data-binary @- https://api.670send.tl/v1/uploads")
[[ $big == 413 ]] && ok "bodies over 3 MB are refused (413)" || bad "oversized body gave $big"

echo "== everything else"
[[ $(dx "curl -sk -o /dev/null -w '%{http_code}' --resolve evil.example:80:127.0.0.1 http://evil.example/") == 000 || $(dx "curl -s -o /dev/null -w '%{http_code}' --resolve evil.example:80:127.0.0.1 http://evil.example/") == 000 ]] && ok "unknown host names get no answer (444)" || bad "unknown host answered"
has "$(hdr 670send.tl /)" "^server: nginx/" && bad "server version leaked" || ok "no Nginx version in the Server header"

echo
echo "passed $pass · failed $fail"
exit $((fail > 0))
