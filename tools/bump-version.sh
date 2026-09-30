#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# KoNfiX Version Bumper (CalVer YYYY.M.PATCH & Monorepo Synchronizer)
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

DRY_RUN=false
DO_COMMIT=false
DO_TAG=false
CUSTOM_VERSION=""

usage() {
    cat << 'EOF'
KoNfiX Version Bumper — Auto version bump up for KoNfiX

Syntax:
  ./tools/bump-version.sh [OPTIONEN] [ZIELVERSION]

Optionen:
  -n, --dry-run     Simulation: Zeigt geplante Änderungen an, ohne Dateien zu schreiben
  -c, --commit      Erstellt automatisch einen Git-Commit ('chore(release): bump version to ...')
  -t, --tag         Erstellt zusätzlich einen Git-Tag ('v...') (impliziert --commit)
  -h, --help        Diese Hilfe anzeigen

Argumente:
  ZIELVERSION       Optionale explizite Version (z. B. 2026.10.0).
                    Wird nichts angegeben, wird die nächste CalVer-Version
                    (YYYY.M.PATCH) automatisch anhand des Datums berechnet.

Beispiele:
  ./tools/bump-version.sh --dry-run
  ./tools/bump-version.sh
  ./tools/bump-version.sh --commit --tag
  ./tools/bump-version.sh 2026.10.0 -c -t
EOF
    exit 0
}

# Argumente parsen
while [[ $# -gt 0 ]]; do
    case "$1" in
        -n|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -c|--commit)
            DO_COMMIT=true
            shift
            ;;
        -t|--tag)
            DO_TAG=true
            DO_COMMIT=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        -*)
            echo "Fehler: Unbekannte Option: $1" >&2
            echo "Nutze --help für die Hilfe." >&2
            exit 1
            ;;
        *)
            if [ -z "$CUSTOM_VERSION" ]; then
                CUSTOM_VERSION="$1"
            else
                echo "Fehler: Zu viele Argumente angegeben ($1)." >&2
                exit 1
            fi
            shift
            ;;
    esac
done

# 1. Aktuelle Version aus Cargo.toml ermitteln
CARGO_TOML="${ROOT_DIR}/crates/knx-core/Cargo.toml"
PACKAGE_JSON="${ROOT_DIR}/apps/web/package.json"
SERVER_RS="${ROOT_DIR}/crates/knx-core/src/server.rs"
CHANGELOG_MD="${ROOT_DIR}/CHANGELOG.md"

if [ ! -f "$CARGO_TOML" ]; then
    echo "Fehler: Cargo.toml nicht gefunden unter: $CARGO_TOML" >&2
    exit 1
fi

CURRENT_VERSION=$(grep -m1 '^version =' "$CARGO_TOML" | sed -E 's/version = "([^"]+)"/\1/')
if [ -z "$CURRENT_VERSION" ]; then
    echo "Fehler: Konnte aktuelle Version aus $CARGO_TOML nicht lesen." >&2
    exit 1
fi

# 2. Neue Version ermitteln
if [ -n "$CUSTOM_VERSION" ]; then
    NEW_VERSION="$CUSTOM_VERSION"
else
    # CalVer: YYYY.M.PATCH
    TODAY_YEAR=$(date +%Y)
    TODAY_MONTH=$(date +%-m)

    IFS='.' read -r CUR_YEAR CUR_MONTH CUR_PATCH <<< "$CURRENT_VERSION"
    CUR_PATCH="${CUR_PATCH:-0}"

    if [ "$TODAY_YEAR" = "$CUR_YEAR" ] && [ "$TODAY_MONTH" = "$CUR_MONTH" ]; then
        NEW_PATCH=$((CUR_PATCH + 1))
    else
        NEW_PATCH=0
    fi
    NEW_VERSION="${TODAY_YEAR}.${TODAY_MONTH}.${NEW_PATCH}"
fi

TODAY_DATE=$(date +%Y-%m-%d)

echo "=========================================================="
echo "KoNfiX Version Bumper"
echo "  Aktuelle Version:  $CURRENT_VERSION"
echo "  Neue Version:      $NEW_VERSION"
echo "  Datum:             $TODAY_DATE"
if [ "$DRY_RUN" = true ]; then
    echo "  Modus:             DRY-RUN (Keine Änderungen geschrieben)"
fi
echo "=========================================================="

if [ "$CURRENT_VERSION" = "$NEW_VERSION" ]; then
    echo "Info: Neue Version entspricht der aktuellen Version ($CURRENT_VERSION). Nichts zu tun."
    exit 0
fi

# Betroffene Dateien auflisten
echo "Zu aktualisierende Komponenten:"
echo "  1. Backend Core:       crates/knx-core/Cargo.toml"
echo "  2. Backend Lockfile:   Cargo.lock"
echo "  3. Server Unit-Test:   crates/knx-core/src/server.rs"
echo "  4. Web Frontend:       apps/web/package.json"
echo "  5. Dokumentation:      CHANGELOG.md"
echo ""

if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] Überprüfung erfolgreich abgeschlossen. Es wurden keine Dateien verändert."
    exit 0
fi

# 3. Dateien atomar aktualisieren
echo "-> Aktualisiere crates/knx-core/Cargo.toml..."
sed -i "s/^version = \"$CURRENT_VERSION\"/version = \"$NEW_VERSION\"/" "$CARGO_TOML"

echo "-> Aktualisiere apps/web/package.json..."
sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON"

echo "-> Aktualisiere server.rs (test_version_endpoint)..."
sed -i "s/assert_eq!(res.0.version, \"$CURRENT_VERSION\")/assert_eq!(res.0.version, \"$NEW_VERSION\")/" "$SERVER_RS"

echo "-> Synchronisiere Cargo.lock..."
(cd "$ROOT_DIR" && cargo check --package knx-core --quiet)

echo "-> Aktualisiere CHANGELOG.md..."
if ! grep -q "## \[$NEW_VERSION\]" "$CHANGELOG_MD"; then
    # Header nach dem ersten horizontalen Trenner '---' einfügen
    awk -v new_ver="$NEW_VERSION" -v date_str="$TODAY_DATE" '
        BEGIN { inserted = 0 }
        /^---$/ && !inserted {
            print $0
            print ""
            print "## [" new_ver "] - " date_str
            print ""
            print "### changed"
            print "- Bumb up version to " new_ver "."
            inserted = 1
            next
        }
        { print }
    ' "$CHANGELOG_MD" > "${CHANGELOG_MD}.tmp" && mv "${CHANGELOG_MD}.tmp" "$CHANGELOG_MD"
    echo "   Abschnitt ## [$NEW_VERSION] in CHANGELOG.md eingefügt."
else
    echo "   Abschnitt ## [$NEW_VERSION] existiert bereits in CHANGELOG.md."
fi

echo ""
echo "✓ Version erfolgreich von $CURRENT_VERSION auf $NEW_VERSION angehoben!"

# 4. Optional: Git Commit & Tag
if [ "$DO_COMMIT" = true ]; then
    echo ""
    echo "-> Erstelle Git-Commit..."
    git -C "$ROOT_DIR" add \
        crates/knx-core/Cargo.toml \
        Cargo.lock \
        apps/web/package.json \
        crates/knx-core/src/server.rs \
        CHANGELOG.md
    
    COMMIT_MSG="chore(release): bump version to $NEW_VERSION

- bump version across Cargo.toml and package.json to $NEW_VERSION
- synchronize test_version_endpoint and Cargo.lock
- update CHANGELOG.md"

    git -C "$ROOT_DIR" commit -m "$COMMIT_MSG"
    echo "✓ Commit erstellt."

    if [ "$DO_TAG" = true ]; then
        echo "-> Erstelle Git-Tag v$NEW_VERSION..."
        git -C "$ROOT_DIR" tag -a "v$NEW_VERSION" -m "Release $NEW_VERSION"
        echo "✓ Tag v$NEW_VERSION erstellt."
    fi
fi

echo ""
echo "Fertig!"
