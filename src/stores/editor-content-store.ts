import { create } from "zustand";
import { combine } from "zustand/middleware";

export const useEditorContentStore = create(
  combine(
    {
      value: "",
      language: "text",
      filename: "",
      filePath: "",
      cursorPosition: 0,
      selectionStart: 0,
      selectionEnd: 0,
      isTyping: false,
    },
    set => ({
      // Core Editor Actions
      setValue: (value: string) => set({ value }),
      setLanguage: (language: string) => set({ language }),
      setFilename: (filename: string) => set({ filename }),
      setFilePath: (filePath: string) => set({ filePath }),
      setCursorPosition: (position: number) => set({ cursorPosition: position }),
      setSelection: (start: number, end: number) =>
        set({ selectionStart: start, selectionEnd: end }),
      setIsTyping: (typing: boolean) => set({ isTyping: typing }),
    }),
  ),
);
