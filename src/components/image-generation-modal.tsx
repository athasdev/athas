import { Download, ImageIcon, Loader2, Sparkles, Wand2, X } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "./ui/button";
import Dropdown from "./ui/dropdown";

interface ImageGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetFolder: string;
  onImageGenerated?: (imagePath: string) => void;
}

const ImageGenerationModal = ({
  isOpen,
  onClose,
  targetFolder,
  onImageGenerated,
}: ImageGenerationModalProps) => {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<"1024x1024" | "1792x1024" | "1024x1792" | "512x512">(
    "1024x1024",
  );
  const [imageStyle, setImageStyle] = useState<"vivid" | "natural">("vivid");
  const [imageModel, setImageModel] = useState<"gpt-image-1" | "dall-e-3" | "dall-e-2">(
    "gpt-image-1",
  );
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError("Please enter a description for the image");
      return;
    }

    setIsGenerating(true);
    setError("");
    setGeneratedImage(null);

    try {
      // Call OpenAI DALL-E API
      const response = await generateImage(prompt, imageSize, imageStyle, imageModel);

      if (response.success && response.imageUrl) {
        setGeneratedImage(response.imageUrl);
        // Auto-generate filename based on prompt
        const sanitizedPrompt = prompt
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, "")
          .replace(/\s+/g, "_")
          .substring(0, 50);
        setFileName(`${sanitizedPrompt}_${Date.now()}.png`);
      } else {
        setError(response.error || "Failed to generate image");
      }
    } catch (err) {
      setError("An error occurred while generating the image");
      console.error("Image generation error:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveImage = async () => {
    if (!generatedImage || !fileName) return;

    try {
      const success = await saveImageToFolder(generatedImage, targetFolder, fileName);
      if (success) {
        const imagePath = `${targetFolder}/${fileName}`;
        onImageGenerated?.(imagePath);
        onClose();
      } else {
        setError(
          "Failed to save image to the selected folder. Please check folder permissions and try again.",
        );
      }
    } catch (err) {
      console.error("Save image error:", err);
      setError(
        `An error occurred while saving the image: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  };

  const handleClose = () => {
    setPrompt("");
    setGeneratedImage(null);
    setFileName("");
    setError("");
    onClose();
  };

  // Reset size when model changes
  useEffect(() => {
    if (imageModel === "dall-e-2" && !["1024x1024", "512x512"].includes(imageSize)) {
      setImageSize("1024x1024");
    }
    if (imageModel === "dall-e-3" && imageSize === "512x512") {
      setImageSize("1024x1024");
    }
    if (
      imageModel === "gpt-image-1" &&
      !["1024x1024", "1536x1024", "1024x1536"].includes(imageSize)
    ) {
      setImageSize("1024x1024");
    }
  }, [imageModel, imageSize]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-lg w-[600px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[var(--text-color)]" />
            <h3 className="font-mono text-sm text-[var(--text-color)]">Generate Image with AI</h3>
          </div>
          <button
            onClick={handleClose}
            className="text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
          {/* Folder Info */}
          <div className="text-xs text-[var(--text-lighter)] leading-relaxed">
            Generate an AI image and save it to:{" "}
            <span className="font-mono text-[var(--text-color)]">
              {targetFolder.split("/").pop() || targetFolder}
            </span>
          </div>

          {/* Prompt Input */}
          <div className="space-y-2">
            <label
              htmlFor="image-description"
              className="flex items-center gap-2 text-xs font-medium text-[var(--text-color)]"
            >
              <Wand2 size={12} />
              Image Description
            </label>
            <textarea
              id="image-description"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe the image you want to generate... (e.g., 'A serene mountain landscape at sunset with a lake reflection')"
              className="w-full px-3 py-2 bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded text-xs text-[var(--text-color)] focus:outline-none focus:border-blue-500 resize-none"
              rows={3}
              disabled={isGenerating}
            />
          </div>

          {/* Generation Options */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="image-size" className="text-xs font-medium text-[var(--text-color)]">
                Size
              </label>
              <Dropdown
                value={imageSize}
                options={
                  imageModel === "gpt-image-1"
                    ? [
                        { value: "1024x1024", label: "Square (1024×1024)" },
                        { value: "1536x1024", label: "Portrait (1536×1024)" },
                        { value: "1024x1536", label: "Landscape (1024×1536)" },
                      ]
                    : imageModel === "dall-e-3"
                      ? [
                          { value: "1024x1024", label: "Square (1024×1024)" },
                          { value: "1792x1024", label: "Landscape (1792×1024)" },
                          { value: "1024x1792", label: "Portrait (1024×1792)" },
                        ]
                      : [
                          { value: "1024x1024", label: "Square (1024×1024)" },
                          { value: "512x512", label: "Small Square (512×512)" },
                        ]
                }
                onChange={(value: string) =>
                  setImageSize(value as "1024x1024" | "1792x1024" | "1024x1792" | "512x512")
                }
                disabled={isGenerating}
                className="text-xs"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="image-style" className="text-xs font-medium text-[var(--text-color)]">
                Style
              </label>
              <Dropdown
                value={imageStyle}
                options={[
                  { value: "vivid", label: "Vivid (more creative)" },
                  { value: "natural", label: "Natural (more realistic)" },
                ]}
                onChange={(value: string) => setImageStyle(value as "vivid" | "natural")}
                disabled={isGenerating || imageModel === "dall-e-2"}
                className="text-xs"
              />
              {imageModel === "dall-e-2" && (
                <p className="text-xs text-[var(--text-lighter)]">
                  Style not available for DALL-E 2
                </p>
              )}
            </div>
          </div>

          {/* Generated Image */}
          {generatedImage && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-[var(--text-color)]">Generated Image</div>
              <div className="border border-[var(--border-color)] rounded-lg overflow-hidden">
                <img
                  src={generatedImage}
                  alt="Generated"
                  className="w-full h-auto max-h-80 object-contain bg-[var(--secondary-bg)]"
                />
              </div>

              {/* Filename Input */}
              <div className="space-y-2">
                <label htmlFor="file-name" className="text-xs font-medium text-[var(--text-color)]">
                  File Name
                </label>
                <input
                  id="file-name"
                  type="text"
                  value={fileName}
                  onChange={e => setFileName(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded text-xs text-[var(--text-color)] focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="text-xs text-red-500 bg-red-500/10 p-2 rounded border border-red-500/20">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-lighter)]">Model:</span>
            <Dropdown
              value={imageModel}
              options={[
                { value: "gpt-image-1", label: "GPT-Image-1" },
                { value: "dall-e-3", label: "DALL-E 3" },
                { value: "dall-e-2", label: "DALL-E 2" },
              ]}
              onChange={(value: string) =>
                setImageModel(value as "gpt-image-1" | "dall-e-3" | "dall-e-2")
              }
              disabled={isGenerating}
              className="text-xs min-w-[120px]"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={handleClose} variant="ghost" size="sm" disabled={isGenerating}>
              Cancel
            </Button>

            {!generatedImage ? (
              <Button
                onClick={handleGenerate}
                variant="default"
                size="sm"
                disabled={isGenerating || !prompt.trim()}
                className="flex items-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <ImageIcon size={12} />
                    Generate
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={handleSaveImage}
                variant="default"
                size="sm"
                disabled={!fileName}
                className="flex items-center gap-2"
              >
                <Download size={12} />
                Save Image
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// AI Image generation function
async function generateImage(
  prompt: string,
  size: string,
  style: string,
  model: string,
): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
  try {
    // Get OpenAI API key from storage
    const { getOpenAIToken } = await import("../utils/ai-chat");
    const apiKey = await getOpenAIToken();

    if (!apiKey) {
      return {
        success: false,
        error: "OpenAI API key not found. Please set up your API key in the AI settings.",
      };
    }

    let response: Response;

    if (model === "gpt-image-1") {
      // Use GPT-Image-1 API
      response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt: prompt,
          size: size,
          quality: style === "vivid" ? "high" : "medium", // Map style to quality
          output_format: "jpeg",
        }),
      });
    } else {
      // Use traditional DALL-E API
      const requestBody: any = {
        model: model,
        prompt: prompt,
        n: 1,
        size: size,
        response_format: "url",
      };

      // Only add style for DALL-E 3
      if (model === "dall-e-3") {
        requestBody.style = style;
      }

      response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
    }

    if (!response.ok) {
      const errorData = await response.json();
      return {
        success: false,
        error: errorData.error?.message || `API Error: ${response.status}`,
      };
    }

    const data = await response.json();

    if (model === "gpt-image-1") {
      // GPT-Image-1 returns base64 data
      if (data.data?.[0]?.b64_json) {
        const base64Data = data.data[0].b64_json;
        const dataUrl = `data:image/jpeg;base64,${base64Data}`;
        return { success: true, imageUrl: dataUrl };
      } else {
        return { success: false, error: "No image data returned from GPT-Image-1" };
      }
    } else {
      // Traditional DALL-E returns URL
      if (data.data?.[0]?.url) {
        return { success: true, imageUrl: data.data[0].url };
      } else {
        return { success: false, error: "No image URL returned from DALL-E API" };
      }
    }
  } catch (error) {
    console.error("Generate image error:", error);
    return { success: false, error: "Failed to generate image" };
  }
}

// Save image to folder function
async function saveImageToFolder(
  imageUrl: string,
  folderPath: string,
  fileName: string,
): Promise<boolean> {
  try {
    console.log("Starting image save process:", { imageUrl, folderPath, fileName });

    let uint8Array: Uint8Array;

    if (imageUrl.startsWith("data:")) {
      // Handle base64 data URL (GPT-Image-1)
      const base64Data = imageUrl.split(",")[1];
      const binaryString = atob(base64Data);
      uint8Array = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
      }
      console.log("Base64 image converted to uint8Array, size:", uint8Array.length);
    } else {
      // Handle regular URL (DALL-E)
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");

      const response = await tauriFetch(imageUrl, {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      uint8Array = new Uint8Array(arrayBuffer);
      console.log("Image downloaded and converted to uint8Array, size:", uint8Array.length);
    }

    // Import Tauri path utilities
    const { writeFile, exists, mkdir } = await import("@tauri-apps/plugin-fs");

    // Create the full file path - handle both absolute and relative paths
    let fullPath = folderPath;

    // If it's not an absolute path, treat it as relative to current working directory
    if (!folderPath.startsWith("/") && !folderPath.match(/^[A-Za-z]:/)) {
      // For relative paths, we'll use the path as-is
      fullPath = folderPath;
    }

    const filePath = `${fullPath}/${fileName}`;
    console.log("Attempting to save to:", filePath);

    // Ensure the directory exists
    try {
      const dirExists = await exists(fullPath);
      if (!dirExists) {
        console.log("Creating directory:", fullPath);
        await mkdir(fullPath, { recursive: true });
      }
    } catch (dirError) {
      console.warn("Could not check/create directory:", dirError);
      // Continue anyway - the directory might exist
    }

    // Save the image using writeBinaryFile
    try {
      await writeFile(filePath, uint8Array);
      console.log("Image saved successfully to:", filePath);
      return true;
    } catch (writeError) {
      console.error("Binary file write error:", writeError);

      // Try with different encoding
      try {
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        // Convert to base64 and save as text (fallback approach)
        const base64 = btoa(String.fromCharCode(...uint8Array));
        const base64Path = filePath.replace(/\.(png|jpg|jpeg)$/i, ".b64");
        await writeTextFile(base64Path, base64);
        console.log("Image saved as base64 to:", base64Path);

        // Convert back to binary using a different approach
        const binaryData = atob(base64);
        const newUint8Array = new Uint8Array(binaryData.length);
        for (let i = 0; i < binaryData.length; i++) {
          newUint8Array[i] = binaryData.charCodeAt(i);
        }

        await writeFile(filePath, newUint8Array);
        console.log("Image converted and saved successfully to:", filePath);
        return true;
      } catch (fallbackError) {
        console.error("Fallback save method also failed:", fallbackError);
        throw new Error(`All save methods failed. Last error: ${fallbackError}`);
      }
    }
  } catch (error) {
    console.error("Save image error:", error);
    return false;
  }
}

export default ImageGenerationModal;
