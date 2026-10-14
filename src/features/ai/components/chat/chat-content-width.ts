import { cva } from "class-variance-authority";

/**
 * The column the transcript, prompts and composer share: centred at a reading width, with side
 * padding that grows with the room the chat has (`@container/chat` in `ai-chat.tsx`).
 */
export const chatContentWidth = cva("mx-auto w-full max-w-4xl px-3 @lg/chat:px-5 @3xl/chat:px-8");
