#!/bin/zsh
# Starts the local Documinder n8n instance at http://localhost:5678 using Node 24.
export PATH="$HOME/n8n-local/node_modules/node/bin:$PATH"
export GENERIC_TIMEZONE="America/Los_Angeles"
export TZ="America/Los_Angeles"
export N8N_DIAGNOSTICS_ENABLED=false
export N8N_PERSONALIZATION_ENABLED=false
export N8N_SECURE_COOKIE=false
export N8N_RUNNERS_ENABLED=true
cd "$HOME/n8n-local"
exec ./node_modules/.bin/n8n start
