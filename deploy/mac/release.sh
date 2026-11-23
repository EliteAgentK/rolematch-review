#!/usr/bin/env bash
# The one way a release reaches live. Built from an exact commit, never the working tree; the running image's identity, not a tag, is what gets recorded and rolled back to. A failed build or a failed check moves nothing.
#   deploy/mac/release.sh build <commit>      builds rolematch:<commit>, labelled with that commit. Refuses a tag that already holds anything else.
#   deploy/mac/release.sh deploy <commit>     preflight, records what is running, runs the new image, checks it reports that commit; on failure goes back
#   deploy/mac/release.sh rollback            back to the image running before the last release, by its identity, and checks that too
#   deploy/mac/release.sh status              what is running, against the record
# LOG is the record: one line per release with commit, image id and what it replaced. Containers and settings come from deploy/mac/run.sh; RELEASE_TARGET=rehearsal does all of this on the isolated stack, which is how rollback is drilled.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; TARGET="${RELEASE_TARGET:-live}"; LOG="${RELEASE_LOG:-$HOME/.rolematch/releases-$TARGET.jsonl}"
if [ "$TARGET" = rehearsal ]; then API=iso-api; ENVF="$HOME/.rolematch/rehearsal.env"; else API=rm-api; ENVF="${ROLEMATCH_ENV:-$HOME/.rolematch/mac.env}"; fi
PORT="$(grep '^PORT=' "$ENVF" | cut -d= -f2)"
die() { echo "RELEASE STOPPED: $1" >&2; exit 4; }
running() { docker inspect --format '{{.Image}}' "$API" 2>/dev/null; }
labelOf() { docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$1" 2>/dev/null; }
start() { if [ "$TARGET" = rehearsal ]; then docker tag "$1" rolematch:rehearsal && "$ROOT/deploy/rehearse.sh" up >/dev/null; else "$ROOT/deploy/mac/run.sh" "$1"; fi; }
says() { for _ in $(seq 1 40); do c="$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/ready" 2>/dev/null | sed -nE 's/.*"commit":"([^"]*)".*/\1/p')"; [ -n "$c" ] && { echo "$c"; return 0; }; sleep 3; done; return 1; }
record() { printf '{"at":"%s","action":"%s","commit":"%s","image":"%s","replacedCommit":"%s","replacedImage":"%s","by":"%s"}\n' "$(date -u +%FT%TZ)" "$1" "$2" "$3" "$4" "$5" "$(git -C "$ROOT" config user.name)" >> "$LOG"; }
case "${1:-}" in
build)
  C="$(git -C "$ROOT" rev-parse --verify "${2:?Which commit?}^{commit}")" || die "no such commit"
  TAG="rolematch:$C"
  if docker image inspect "$TAG" >/dev/null 2>&1; then [ "$(labelOf "$TAG")" = "$C" ] && { echo "already built: $TAG"; exit 0; }; die "$TAG exists and was not built from that commit. Nothing overwritten."; fi
  CTX="$(mktemp -d)"; trap 'rm -rf "$CTX"' EXIT
  git -C "$ROOT" archive "$C" | tar -x -C "$CTX" || die "could not take the commit's files"
  docker build -q --label "org.opencontainers.image.revision=$C" --build-arg ROLEMATCH_COMMIT="$C" -t "$TAG" "$CTX" >/dev/null || die "the build failed; no tag was moved"
  [ "$(labelOf "$TAG")" = "$C" ] || die "the image's label does not match"
  echo "built $TAG $(docker image inspect --format '{{.Id}}' "$TAG")"
  ;;
deploy)
  C="$(git -C "$ROOT" rev-parse --verify "${2:?Which commit?}^{commit}")" || die "no such commit"; TAG="rolematch:$C"
  "$ROOT/deploy/preflight.sh" "$TARGET" || die "preflight"
  [ "$(labelOf "$TAG")" = "$C" ] || die "$TAG was not built from this commit by this script"
  PREV_IMAGE="$(running)"; PREV_COMMIT="$(says || echo unknown)"
  [ -n "$PREV_IMAGE" ] && { docker image inspect "$PREV_IMAGE" >/dev/null 2>&1 || die "the image to roll back to is gone"; }
  start "$TAG"
  GOT="$(says || echo none)"; IMAGE="$(running)"
  if [ "$GOT" = "$C" ] && [ "$IMAGE" = "$(docker image inspect --format '{{.Id}}' "$TAG")" ]; then record deploy "$C" "$IMAGE" "$PREV_COMMIT" "$PREV_IMAGE"; echo "live on $C ($IMAGE); rollback target $PREV_COMMIT ($PREV_IMAGE)"; exit 0; fi
  echo "The new release did not report itself: wanted $C, got $GOT. Going back." >&2
  [ -n "$PREV_IMAGE" ] && start "$PREV_IMAGE"
  die "deploy failed; restored $PREV_COMMIT"
  ;;
rollback)
  "$ROOT/deploy/preflight.sh" "$TARGET" || die "preflight"
  LAST="$(tail -1 "$LOG" 2>/dev/null)"; [ -n "$LAST" ] || die "no release recorded"
  IMG="$(printf '%s' "$LAST" | sed -nE 's/.*"replacedImage":"([^"]*)".*/\1/p')"; CM="$(printf '%s' "$LAST" | sed -nE 's/.*"replacedCommit":"([^"]*)".*/\1/p')"
  [ -n "$IMG" ] || die "the last release replaced nothing"; docker image inspect "$IMG" >/dev/null 2>&1 || die "the image $IMG is gone"
  NOW_IMAGE="$(running)"; NOW_COMMIT="$(says || echo unknown)"
  start "$IMG"
  GOT="$(says || echo none)"
  [ "$(running)" = "$IMG" ] || die "after rollback a different image is running"
  [ "$CM" = unknown ] || [ "$GOT" = "$CM" ] || die "after rollback it reports $GOT, wanted $CM"
  record rollback "$GOT" "$IMG" "$NOW_COMMIT" "$NOW_IMAGE"; echo "rolled back to $GOT ($IMG)"
  ;;
status) echo "running image $(running), reports $(says || echo nothing)"; tail -1 "$LOG" 2>/dev/null ;;
*) sed -n 2,8p "$0"; exit 2 ;;
esac
