#!/usr/bin/env bash
# Export the layers of the character generator PSD into one 144x192 PNG per
# layer (positioned on the full sheet) plus a manifest the map loads. The PSD
# is a 3x4 grid of 48x48 frames: rows face down, left, right, up; columns are
# walk frames. Needs ImageMagick's convert/identify. Run from anywhere:
#   frontend/scripts/export-sprites.sh
set -euo pipefail
cd "$(dirname "$0")/../src/assets/map/sprite"
PSD="Rpg Character Sprite Sheet Generator.psd"
rm -rf layers && mkdir -p layers

# PSD layer index ranges per category, in draw order (bottom first). Layers 1
# (background) and 99 (a hue adjustment) are not exported.
category() {
  local i=$1
  if   (( i == 2 ));              then echo shadow
  elif (( i >= 3   && i <= 9 ));   then echo skin
  elif (( i >= 10  && i <= 18 ));  then echo pants
  elif (( i >= 19  && i <= 35 ));  then echo outfit
  elif (( i >= 36  && i <= 39 ));  then echo facepaint
  elif (( i >= 40  && i <= 47 ));  then echo eyes
  elif (( i >= 48  && i <= 53 ));  then echo tabard
  elif (( i >= 54  && i <= 57 ));  then echo cape
  elif (( i == 66 ));              then echo glasses
  elif (( i >= 58  && i <= 69 ));  then echo accessory
  elif (( i >= 70  && i <= 74 ));  then echo beard
  elif (( i >= 75  && i <= 77 ));  then echo face
  elif (( i >= 78  && i <= 82 ));  then echo brows
  elif (( i >= 83  && i <= 105 && i != 99 )); then echo hair
  elif (( i >= 106 && i <= 119 )); then echo headwear
  elif (( i >= 120 && i <= 122 )); then echo ears
  fi
}

mapfile -t LABELS < <(identify -verbose "$PSD" 2>/dev/null | sed -n 's/^ *label: //p' | iconv -f latin1 -t utf-8)

{
  echo '['
  first=1
  for idx in "${!LABELS[@]}"; do
    i=$((idx + 1)) # label N belongs to PSD image N (image 0 is the composite)
    cat=$(category "$i")
    [[ -z $cat ]] && continue
    label=${LABELS[$idx]}
    slug=$(printf '%03d-%s' "$i" "$(echo "$label" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/-$//')")
    mkdir -p "layers/$cat"
    convert -size 144x192 xc:none \( "$PSD[$i]" -set compose Over \) -background none -flatten \
      -define png:color-type=6 "layers/$cat/$slug.png"
    (( first )) || echo ','
    first=0
    printf '  {"cat": "%s", "label": "%s", "file": "%s/%s.png"}' "$cat" "$label" "$cat" "$slug"
  done
  echo
  echo ']'
} > manifest.json
echo "exported $(find layers -name '*.png' | wc -l) layers"
