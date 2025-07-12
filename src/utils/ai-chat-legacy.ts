import { buildContextPrompt, buildSystemPrompt } from "./context-builder";
import { getOpenAIToken } from "./token-manager";
import type { ContextInfo } from "./types";

// Legacy function for backward compatibility
export const getOpenAIChatCompletionStream = async (
  userMessage: string,
  context: ContextInfo,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: string) => void,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<void> => {
  // Import getChatCompletionStream from main module to avoid circular dependency
  const { getChatCompletionStream } = await import("./ai-chat");
  return getChatCompletionStream(
    "openai",
    "gpt-3.5-turbo",
    userMessage,
    context,
    onChunk,
    onComplete,
    onError,
    conversationHistory,
  );
};

// Main function to get AI chat completion (non-streaming fallback)
export const getOpenAIChatCompletion = async (
  userMessage: string,
  context: ContextInfo,
): Promise<string | null> => {
  try {
    const apiKey = await getOpenAIToken();
    if (!apiKey) {
      throw new Error("OpenAI API key not found");
    }

    const contextPrompt = buildContextPrompt(context);
    const systemPrompt = buildSystemPrompt(contextPrompt);

    const payload = {
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
      max_tokens: 1000,
      temperature: 0.7,
      stream: false,
    };

    console.log("🤖 Making OpenAI chat request...");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error("❌ OpenAI API error:", response.status, response.statusText);
      const errorText = await response.text();
      console.error("❌ Error details:", errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const result = await response.json();

    if (result.choices && result.choices.length > 0) {
      const completion = result.choices[0].message.content.trim();
      console.log("✅ OpenAI chat completion received");
      return completion;
    }

    console.log("❌ No choices in OpenAI response");
    return null;
  } catch (error) {
    console.error("❌ OpenAI chat completion error:", error);
    throw error;
  }
};

// Quick context analysis for specific queries
export const analyzeCurrentFile = async (context: ContextInfo): Promise<string | null> => {
  if (!context.activeBuffer || context.activeBuffer.isSQLite) {
    return "No suitable file is currently open for analysis.";
  }

  const analysisPrompt = `Please analyze this ${context.language || "code"} file and provide:
1. A brief summary of what the code does
2. Any potential issues or improvements
3. Code quality assessment
4. Suggestions for optimization or best practices

Focus on actionable insights.`;

  return getOpenAIChatCompletion(analysisPrompt, context);
};

// Help with debugging
export const getDebuggingHelp = async (
  error: string,
  context: ContextInfo,
): Promise<string | null> => {
  const debugPrompt = `I'm encountering this error: "${error}"

Can you help me debug this issue? Please provide:
1. Possible causes of this error
2. How to fix it step by step
3. Prevention strategies for the future

If you can see relevant code in the context, please point out specific lines or patterns that might be causing the issue.`;

  return getOpenAIChatCompletion(debugPrompt, context);
};

// Code explanation
export const explainCode = async (
  codeSnippet: string,
  context: ContextInfo,
): Promise<string | null> => {
  const explainPrompt = `Please explain this code snippet:

\`\`\`${context.language?.toLowerCase() || "text"}
${codeSnippet}
\`\`\`

Please provide:
1. What this code does line by line
2. The overall purpose and functionality
3. Any important patterns or concepts used
4. How it fits into the larger context (if visible)`;

  return getOpenAIChatCompletion(explainPrompt, context);
};
