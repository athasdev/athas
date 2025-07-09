import {
  Database,
  File,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  Settings,
} from "lucide-react";

interface FileIconProps {
  fileName: string;
  isDir: boolean;
  isExpanded?: boolean;
  size?: number;
  className?: string;
}

const FileIcon = ({
  fileName,
  isDir,
  isExpanded = false,
  size = 14,
  className = "text-[var(--text-lighter)]",
}: FileIconProps) => {
  if (isDir) {
    return isExpanded ? (
      <FolderOpen size={size} className={className} />
    ) : (
      <Folder size={size} className={className} />
    );
  }

  const lowerFileName = fileName.toLowerCase();
  const extension = fileName.split(".").pop()?.toLowerCase();
  const iconProps = { size, className };

  // Handle compound extensions like .html.erb
  if (lowerFileName.endsWith(".html.erb")) {
    return <FileCode {...iconProps} />;
  }

  switch (extension) {
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
    case "py":
    case "rb":
    case "php":
    case "java":
    case "cpp":
    case "c":
    case "cs":
    case "go":
    case "rs":
    case "swift":
    case "kt":
    case "scala":
    case "html":
    case "css":
    case "scss":
    case "sass":
    case "less":
    case "vue":
    case "svelte":
    case "erb":
      return <FileCode {...iconProps} />;

    case "md":
    case "txt":
    case "rtf":
    case "doc":
    case "docx":
      return <FileText {...iconProps} />;

    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
    case "ico":
    case "bmp":
    case "tiff":
    case "tif":
    case "avif":
    case "heic":
    case "heif":
    case "jfif":
    case "pjpeg":
    case "pjp":
    case "apng":
      return <FileImage {...iconProps} />;

    case "sqlite":
    case "db":
    case "sqlite3":
      return <Database {...iconProps} />;

    case "mp4":
    case "avi":
    case "mov":
    case "wmv":
    case "flv":
    case "webm":
    case "mkv":
      return <FileVideo {...iconProps} />;

    case "mp3":
    case "wav":
    case "flac":
    case "aac":
    case "ogg":
    case "m4a":
      return <FileAudio {...iconProps} />;

    case "json":
    case "xml":
    case "yaml":
    case "yml":
    case "toml":
    case "ini":
    case "cfg":
    case "conf":
      return <Settings {...iconProps} />;

    default:
      return <File {...iconProps} />;
  }
};

export default FileIcon;
