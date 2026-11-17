# Athas shell integration for fish: emits OSC 133 prompt and command marks
# plus OSC 7 working directory reports so the terminal can track commands.
if status is-interactive; and set -q ATHAS_SHELL_INTEGRATION; and not set -q ATHAS_SHELL_INTEGRATION_LOADED
    set -g ATHAS_SHELL_INTEGRATION_LOADED 1

    function __athas_osc
        printf '\e]%s\a' $argv[1]
    end

    function __athas_precmd --on-event fish_prompt
        set -l exit_code $status
        if set -q __athas_command_running
            __athas_osc "133;D;$exit_code"
            set -e __athas_command_running
        end
        __athas_osc "7;file://$hostname$PWD"
        __athas_osc "133;A"
    end

    function __athas_preexec --on-event fish_preexec
        set -g __athas_command_running 1
        __athas_osc "133;C"
    end

    if functions -q fish_prompt; and not functions -q __athas_user_fish_prompt
        functions -c fish_prompt __athas_user_fish_prompt
        function fish_prompt
            __athas_user_fish_prompt
            __athas_osc "133;B"
        end
    end
end
