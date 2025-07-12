export interface CompletionRequest {
  code: string;
  language: string;
  filename: string;
  cursorPosition: number;
}

export interface CompletionResponse {
  completion: string;
  confidence: number;
}

// OpenAI API configuration (real working API)
const AI_CONFIG = {
  // OpenAI API for code completion
  openaiApiUrl: "https://api.openai.com/v1/chat/completions",
  // GitHub Copilot API (currently not publicly available)
  copilotApiUrl: "https://api.githubcopilot.com/v1/completions", // This doesn't work
};

// Real OpenAI API integration (working alternative)
export const getOpenAICompletion = async (
  request: CompletionRequest,
): Promise<CompletionResponse | null> => {
  try {
    // Get API key from storage (we'll use the same storage as GitHub token for now)
    const apiKey = await getGitHubToken(); // Reusing the same storage
    if (!apiKey) {
      console.log("❌ API key not found. Using fallback completions.");
      return getFallbackCompletion(request);
    }

    console.log("🔑 API key found, making OpenAI request...");

    const prompt = preparePromptForCompletion(request);

    const completionPayload = {
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "You are a code completion assistant. Complete the code at the cursor position. Return ONLY the completion text without markdown, explanations, or code blocks. Keep completions concise and practical.",
        },
        {
          role: "user",
          content: `Complete this ${request.language} code at the cursor position (marked with |CURSOR|):\n\n${prompt}`,
        },
      ],
      max_tokens: 30, // Shorter completions
      temperature: 0.1, // More deterministic
      stream: false,
      stop: ["\n\n", "```"], // Stop at double newlines or code blocks
    };

    // Only log payload in development
    if (import.meta.env.DEV) {
      console.log("📤 OpenAI API payload:", completionPayload);
    }

    const response = await fetch(AI_CONFIG.openaiApiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(completionPayload),
    });

    if (!response.ok) {
      console.error("❌ OpenAI API error:", response.status, response.statusText);
      const errorText = await response.text();
      console.error("❌ Error details:", errorText);
      return getFallbackCompletion(request);
    }

    const result = await response.json();

    // Only log full result in development
    if (import.meta.env.DEV) {
      console.log("📋 OpenAI API result:", result);
    }

    if (result.choices && result.choices.length > 0) {
      const completion = result.choices[0].message.content.trim();
      return {
        completion,
        confidence: 0.9,
      };
    }

    console.log("❌ No choices in OpenAI response");
    return null;
  } catch (error) {
    console.error("❌ OpenAI API error:", error);
    return getFallbackCompletion(request);
  }
};

// GitHub Copilot API (currently not working - keeping for reference)
export const getGitHubCopilotCompletion = async (
  _request: CompletionRequest,
): Promise<CompletionResponse | null> => {
  console.log("⚠️ GitHub Copilot API not publicly available, skipping...");
  return null;
};

// Get GitHub token from secure storage
const getGitHubToken = async (): Promise<string | null> => {
  try {
    return await getTokenFromTauriStorage();
  } catch (error) {
    console.error("Error getting GitHub token:", error);
    return null;
  }
};

// Tauri secure storage implementation
const getTokenFromTauriStorage = async (): Promise<string | null> => {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const token = (await invoke("get_github_token")) as string | null;
    return token;
  } catch (error) {
    console.error("Error getting GitHub token from Tauri storage:", error);
    return null;
  }
};

// Store GitHub token securely
export const storeGitHubToken = async (token: string): Promise<void> => {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("store_github_token", { token });
  } catch (error) {
    console.error("Error storing GitHub token:", error);
    throw error;
  }
};

// Remove GitHub token from storage
export const removeGitHubToken = async (): Promise<void> => {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("remove_github_token");
  } catch (error) {
    console.error("Error removing GitHub token:", error);
    throw error;
  }
};

// Prepare prompt for completion (works with any API)
const preparePromptForCompletion = (request: CompletionRequest): string => {
  const lines = request.code.split("\n");
  const currentLineIndex = request.code.substring(0, request.cursorPosition).split("\n").length - 1;

  // Include context before and after cursor
  const contextBefore = lines
    .slice(Math.max(0, currentLineIndex - 5), currentLineIndex + 1)
    .join("\n");
  const contextAfter = lines
    .slice(currentLineIndex + 1, Math.min(lines.length, currentLineIndex + 6))
    .join("\n");

  return `${contextBefore}|CURSOR|${contextAfter}`;
};

// Legacy function for compatibility
// @ts-ignore Ignoring this unused function for now in case it's needed later
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _preparePromptForCopilot = (request: CompletionRequest): string => {
  return preparePromptForCompletion(request);
};

// Main function that tries Copilot first, then falls back
export const getAICompletion = async (
  request: CompletionRequest,
): Promise<CompletionResponse | null> => {
  console.log("🤖 AI Completion Request:", {
    language: request.language,
    filename: request.filename,
    linePrefix: `${getCurrentLine(request).trim().substring(0, 20)}...`,
  });

  // Try OpenAI first
  let completion = await getOpenAICompletion(request);

  if (completion) {
    console.log("✅ OpenAI completion received:", `${completion.completion.substring(0, 50)}...`);
    return completion;
  }

  // If that fails, try GitHub Copilot
  completion = await getGitHubCopilotCompletion(request);

  if (completion) {
    console.log("✅ GitHub Copilot completion received:", completion);
    return completion;
  }

  // Final fallback to pattern-based completions
  completion = getFallbackCompletion(request);

  if (completion) {
    console.log("✅ Fallback completion received:", completion.completion);
  } else {
    console.log("❌ No completion available");
  }

  return completion;
};

// Fallback to pattern-based completions (your existing logic)
const getFallbackCompletion = (request: CompletionRequest): CompletionResponse | null => {
  try {
    console.log("🔄 Trying fallback completion for:", request.language);

    const lines = request.code.split("\n");
    const currentLineIndex =
      request.code.substring(0, request.cursorPosition).split("\n").length - 1;
    const currentLine = lines[currentLineIndex] || "";
    const cursorInLine =
      request.cursorPosition -
      request.code.substring(0, request.cursorPosition).lastIndexOf("\n") -
      1;
    const linePrefix = currentLine.substring(0, cursorInLine);

    console.log("📝 Current line prefix:", linePrefix);

    const completions = getPatternBasedCompletions(linePrefix, request.language);

    if (completions.length > 0) {
      console.log("✅ Found pattern completion:", completions[0]);
      return {
        completion: completions[0],
        confidence: 0.6, // Lower confidence for fallback
      };
    }

    console.log("❌ No fallback completion found");
    return null;
  } catch (error) {
    console.error("Fallback completion error:", error);
    return null;
  }
};

// Pattern-based completions for demonstration
const getPatternBasedCompletions = (linePrefix: string, language: string): string[] => {
  const completions: string[] = [];

  // JavaScript/TypeScript patterns
  if (language === "javascript" || language === "typescript") {
    if (linePrefix.includes("console.")) {
      completions.push("log()");
    }
    if (linePrefix.includes("document.")) {
      completions.push("querySelector()");
      completions.push("getElementById()");
    }
    if (linePrefix.includes("function ")) {
      completions.push("() {\n  \n}");
    }
    if (linePrefix.includes("const ") && linePrefix.includes(" = ")) {
      completions.push("useState()");
      completions.push("useEffect()");
    }
    if (linePrefix.includes("import ")) {
      completions.push("React from 'react'");
      completions.push("{ useState } from 'react'");
    }
    if (linePrefix.includes("export ")) {
      completions.push("default ");
      completions.push("const ");
    }
  }

  // Python patterns
  if (language === "python") {
    if (linePrefix.includes("def ")) {
      completions.push("():\n    pass");
    }
    if (linePrefix.includes("class ")) {
      completions.push(":\n    def __init__(self):\n        pass");
    }
    if (linePrefix.includes("import ")) {
      completions.push("numpy as np");
      completions.push("pandas as pd");
    }
    if (linePrefix.includes("print(")) {
      completions.push('f""');
    }
  }

  // CSS patterns
  if (language === "css") {
    if (linePrefix.includes("display: ")) {
      completions.push("flex");
      completions.push("grid");
      completions.push("block");
    }
    if (linePrefix.includes("position: ")) {
      completions.push("relative");
      completions.push("absolute");
      completions.push("fixed");
    }
  }

  // HTML patterns
  if (language === "markup") {
    if (linePrefix.includes("<")) {
      completions.push("div></div>");
      completions.push("span></span>");
      completions.push("p></p>");
    }
  }

  return completions;
};

// Debounced completion requests with better logic
let completionTimeout: ReturnType<typeof setTimeout> | null = null;
let lastRequestTime = 0;
let lastRequestCode = "";

export const requestCompletion = (
  request: CompletionRequest,
  callback: (completion: CompletionResponse | null) => void,
  delay: number = 100, // Much shorter delay - almost instant
) => {
  if (completionTimeout) {
    clearTimeout(completionTimeout);
  }

  // Prevent too frequent requests
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  // Don't request if:
  // 1. Less than 100ms since last request (reduced from 500ms)
  // 2. Code hasn't changed significantly
  // 3. Current line is too short (less than 3 chars)
  const currentLine = getCurrentLine(request);

  console.log("⏰ Completion request check:", {
    timeSinceLastRequest,
    currentLineLength: currentLine.trim().length,
    codeChanged: request.code !== lastRequestCode,
    currentLine: currentLine.trim(),
  });

  if (
    timeSinceLastRequest < 100 || // Reduced from 500ms
    request.code === lastRequestCode ||
    currentLine.trim().length < 3
  ) {
    console.log("🚫 Completion request blocked:", {
      tooSoon: timeSinceLastRequest < 100,
      sameCode: request.code === lastRequestCode,
      lineTooShort: currentLine.trim().length < 3,
    });
    return;
  }

  console.log("✅ Completion request approved, waiting:", `${delay}ms`);

  completionTimeout = setTimeout(async () => {
    lastRequestTime = Date.now();
    lastRequestCode = request.code;

    const completion = await getAICompletion(request);
    callback(completion);
  }, delay);
};

// Helper function to get current line
const getCurrentLine = (request: CompletionRequest): string => {
  const lines = request.code.split("\n");
  const currentLineIndex = request.code.substring(0, request.cursorPosition).split("\n").length - 1;
  return lines[currentLineIndex] || "";
};

export const cancelCompletion = () => {
  if (completionTimeout) {
    clearTimeout(completionTimeout);
    completionTimeout = null;
  }
};
