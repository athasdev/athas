import type { Meta, StoryObj } from "@storybook/react-vite";

import { VirtualizedList } from "./VirtualizedList";

const meta = {
  component: VirtualizedList,
  decorators: [
    (Story) => (
      <div style={{ height: "400px", overflow: "auto" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof VirtualizedList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default = {} satisfies Story;
