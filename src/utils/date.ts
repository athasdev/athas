import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

export const formatRelativeTime = (timestamp: number) => {
  return dayjs(timestamp * 1000).fromNow();
};

export const formatDate = (timestamp: number) => {
  return dayjs(timestamp * 1000).format("YYYY-MM-DD HH:mm");
};
