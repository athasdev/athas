# Athas shell integration for zsh: emits OSC 133 prompt and command marks
# plus OSC 7 working directory reports so the terminal can track commands.
if [[ -n "${ATHAS_SHELL_INTEGRATION_LOADED-}" || -z "${ATHAS_SHELL_INTEGRATION-}" ]]; then
  return
fi
ATHAS_SHELL_INTEGRATION_LOADED=1

__athas_osc() {
  builtin printf '\e]%s\a' "$1"
}

__athas_report_cwd() {
  __athas_osc "7;file://${HOST:-localhost}${PWD}"
}

__athas_precmd() {
  local exit_code=$?
  if [[ -n "${__athas_command_running-}" ]]; then
    __athas_osc "133;D;${exit_code}"
    __athas_command_running=""
  fi
  __athas_report_cwd
  __athas_osc "133;A"
}

__athas_preexec() {
  __athas_command_running=1
  __athas_osc "133;C"
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd __athas_precmd
add-zsh-hook preexec __athas_preexec

if [[ "$PS1" != *'133;B'* ]]; then
  PS1="${PS1}"$'%{\e]133;B\a%}'
fi
