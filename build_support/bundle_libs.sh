#!/usr/bin/env bash

set -euo pipefail

pushd() {
    builtin pushd "$@" > /dev/null
}
popd() {
    builtin popd "$@" > /dev/null
}

pushd "$2"
inserting_libs=(*.dylib)
popd

inserting_lib_locs=($2/*.dylib)
cp -R "${inserting_lib_locs[@]}" "$1/Contents/MacOS/"

patch() {
    pushd "$1"
    for bin in "${@:2}"; do
        used_libs=()
        while IFS= read -r line; do
            used_libs+=("$line")
        done < <(otool -L "$bin")

	for lib in "${used_libs[@]:1}"; do
            lib=$(echo "${lib%%\(*}" | xargs)

            if ! echo "$lib" | grep -qF '@executable_path/'; then
                for insert in "${inserting_libs[@]}"; do
                    if [ "${lib##*/}" = "$insert" ]; then
                        install_name_tool -change "$lib" "@executable_path/$insert" "$bin"
                    fi
                done
            fi
        done
    done
    popd
}
patch_all_dylibs() {
    pushd "$1"
    patch . *.dylib
    popd
}

patch_all_dylibs "$1/Contents/MacOS/"
patch "$1/Contents/MacOS/" arcticfox XUL
patch "$1/Contents/Resources/" arcticfox-bin
patch "$1/Contents/MacOS/plugin-container.app/Contents/MacOS/" plugin-container
