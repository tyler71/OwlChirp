#!/bin/bash
set -e

app_name="owlchirp"
module="github.com/tyler71/owlchirp"
module_name="${module}/app/cmd/api"

if [[ -n "${NO_COMPRESS}" ]]; then
  echo "Not Compressing"
fi

if [ -n "$1" ];
then
  os_archs=("$1")
else
# Operating systems and architectures to build for
  os_archs=(
#    "darwin/amd64"
#    "darwin/arm64"
#    "dragonfly/amd64"
#    "freebsd/386"
#    "freebsd/amd64"
#    "freebsd/arm"
#    "linux/386"
    "linux/amd64"
#    "linux/arm"
#    "linux/arm64"
#    "linux/ppc64"
#    "linux/ppc64le"
#    "linux/mips"
#    "linux/mipsle"
#    "linux/mips64"
#    "linux/mips64le"
#    "netbsd/386"
#    "netbsd/amd64"
#    "netbsd/arm"
#    "openbsd/386"
#    "openbsd/amd64"
#    "openbsd/arm"
#    "plan9/386"
#    "plan9/amd64"
#    "solaris/amd64"
#    "windows/386"
#    "windows/amd64"
  )
fi

# Loop through each OS/architecture combination
mkdir -p build
echo "Building..."
for os_arch in "${os_archs[@]}"; do
  # Split the string into OS and architecture
  os=$(echo "$os_arch" | cut -d/ -f1)
  arch=$(echo "$os_arch" | cut -d/ -f2)

  # Set GOOS and GOARCH environment variables
  export GOOS="$os"
  export GOARCH="$arch"

  modified=""
  if [ -d .git ]; then
    GIT_SHA=$(git rev-parse --short HEAD)
    git diff-index --quiet HEAD || modified="-dirty"
  fi

  # Set the output file name (e.g., myapp-darwin-amd64)
  output_file="$app_name-$os-$arch${modified}"


  if [[ "$os" == "windows" ]]; then
    output_file="$output_file.exe" # Add .exe extension for Windows
  fi

  # Build!
  echo -e "\t$os/$arch (${VERSION}): $output_file"
  go build -ldflags "-s -w -X ${module}/app/internal/version.BuildVersion=${VERSION}" -o build/"$output_file" "$module_name" || exit 1
  if [[ -n "${NO_COMPRESS}" ]]; then
    continue
  else
    if [[ "${output_file##*.}" == "exe" ]]
    then
      zip --quiet build/"$app_name-$os-$arch".zip build/"$output_file"
      rm build/"$output_file"
    else
      gzip -f build/"$output_file"
    fi
  fi

  echo " - Complete!"
done

echo "Build complete!"
