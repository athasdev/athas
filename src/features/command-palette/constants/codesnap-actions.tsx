import { Camera, Image } from "@phosphor-icons/react";
import { codesnapFromActiveBuffer, codesnapFromSelection } from "@/features/codesnap/lib/triggers";
import type { Action } from "../models/action.types";

export const codesnapActions: Action[] = [
  {
    id: "codesnap.fromSelection",
    label: "CodeSnap: From Selection",
    description: "Open a styled screenshot of the current selection",
    icon: <Camera />,
    category: "View",
    commandId: "codesnap.fromSelection",
    action: codesnapFromSelection,
  },
  {
    id: "codesnap.fromFile",
    label: "CodeSnap: Whole File",
    description: "Open a styled screenshot of the entire active file",
    icon: <Image />,
    category: "View",
    commandId: "codesnap.fromFile",
    action: codesnapFromActiveBuffer,
  },
];
