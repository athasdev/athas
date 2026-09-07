# Athas shell integration for bash. Loaded through --init-file, so it first
# runs the files an interactive shell would have read on its own, then emits
# OSC 133 prompt and command marks plus OSC 7 working directory reports.
#
# ATHAS_SHELL_LOGIN is set when the shell would normally have been a login
# shell (Git Bash on Windows). A login shell reads the profile files and
# leaves ~/.bashrc to them, so mirror that instead of reading ~/.bashrc twice.
if [[ -n "${ATHAS_SHELL_LOGIN-}" ]]; then
  unset ATHAS_SHELL_LOGIN
  if [[ -r /etc/profile ]]; then
    source /etc/profile
  fi
  for __athas_profile in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
    if [[ -r "$__athas_profile" ]]; then
      source "$__athas_profile"
      break
    fi
  done
  unset __athas_profile
else
  if [[ -r /etc/bash.bashrc ]]; then
    source /etc/bash.bashrc
  fi
  if [[ -r "$HOME/.bashrc" ]]; then
    source "$HOME/.bashrc"
  fi
fi

if [[ -n "${ATHAS_SHELL_INTEGRATION_LOADED-}" || -z "${ATHAS_SHELL_INTEGRATION-}" ]]; then
  return 0 2>/dev/null
fi
ATHAS_SHELL_INTEGRATION_LOADED=1

__athas_osc() {
  builtin printf '\e]%s\a' "$1"
}

__athas_precmd() {
  local exit_code=$?
  if [[ -n "${__athas_command_running-}" ]]; then
    __athas_osc "133;D;${exit_code}"
    __athas_command_running=""
  fi
  __athas_osc "7;file://${HOSTNAME:-localhost}${PWD}"
  __athas_osc "133;A"
}

__athas_interactive_mode() {
  __athas_interactive=1
}

__athas_preexec() {
  if [[ -n "${COMP_LINE-}" || -z "${__athas_interactive-}" || "$BASH_SUBSHELL" != "0" ]]; then
    return
  fi
  __athas_interactive=""
  __athas_command_running=1
  __athas_osc "133;C"
}

if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  PROMPT_COMMAND=(__athas_precmd "${PROMPT_COMMAND[@]}" __athas_interactive_mode)
else
  PROMPT_COMMAND="__athas_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND};__athas_interactive_mode"
fi
trap '__athas_preexec' DEBUG

if [[ "$PS1" != *'133;B'* ]]; then
  PS1="${PS1}\[\e]133;B\a\]"
fi
