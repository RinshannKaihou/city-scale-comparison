#!/bin/bash
set -e

CITIES=(
  "Beijing|北京|China|Beijing,%20China"
  "Shanghai|上海|China|Shanghai,%20China"
  "Tokyo|东京|Japan|Tokyo,%20Japan"
  "New%20York|纽约|USA|New%20York%20City,%20USA"
  "London|伦敦|UK|London,%20UK"
  "Paris|巴黎|France|Paris,%20France"
  "Moscow|莫斯科|Russia|Moscow,%20Russia"
  "Sydney|悉尼|Australia|Sydney,%20Australia"
  "Singapore|新加坡|Singapore|Singapore"
  "Dubai|迪拜|UAE|Dubai,%20UAE"
  "Mumbai|孟买|India|Mumbai,%20India"
  "São%20Paulo|圣保罗|Brazil|São%20Paulo,%20Brazil"
  "Cairo|开罗|Egypt|Cairo,%20Egypt"
  "Los%20Angeles|洛杉矶|USA|Los%20Angeles,%20USA"
  "Seoul|首尔|South%20Korea|Seoul,%20South%20Korea"
)

OUTPUT_DIR="$(dirname "$0")/../public/data"
mkdir -p "$OUTPUT_DIR"

i=0
for city in "${CITIES[@]}"; do
  IFS='|' read -r name nameZh country query <<< "$city"
  echo "Fetching $name..."
  url="https://nominatim.openstreetmap.org/search?q=${query}&format=json&polygon_geojson=1&limit=1"
  curl -s -H "User-Agent: CityScaleCompare/1.0" -H "Accept: application/json" "$url" > "$OUTPUT_DIR/${name}.json"
  # Nominatim requires 1 sec between requests
  if [ $i -lt $((${#CITIES[@]} - 1)) ]; then
    sleep 1.2
  fi
  i=$((i + 1))
done

echo "All raw data fetched."
