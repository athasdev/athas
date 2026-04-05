#!/bin/bash

# Get the hook input
input=$(cat)

# Extract session_id from the input
session_id=$(echo "$input" | jq -r '.session_id')

# Check if any .ts or .tsx files were modified during this session
# Look through git status to see if TypeScript files were touched
if git status --porcelain | grep -E '\.tsx?$' > /dev/null; then
    echo "TypeScript files were modified, running checks..."


    bun typecheck
    typecheck_exit=$?

    if [ $typecheck_exit -ne 0 ]; then
        echo "bun typecheck (tsc) failing" >&2
        exit 2
    fi

    bun check
    check_exit=$?

    if [ $check_exit -ne 0 ]; then
        echo "'bun check' failing; try 'bun fix' for auto-fixes and 'bun format' for formatting only" >&2
        exit 2
    fi
fi
