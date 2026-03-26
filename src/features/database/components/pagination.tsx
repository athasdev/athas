import { useState } from "react";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import Select from "@/ui/select";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export default function Pagination({
  currentPage,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const [pageInput, setPageInput] = useState(currentPage.toString());

  const handlePageInputChange = (value: string) => {
    setPageInput(value);
  };

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const page = parseInt(pageInput, 10);
    if (page >= 1 && page <= totalPages) {
      onPageChange(page);
    } else {
      setPageInput(currentPage.toString());
    }
  };

  const handlePageInputBlur = () => {
    const page = parseInt(pageInput, 10);
    if (!(page >= 1 && page <= totalPages)) {
      setPageInput(currentPage.toString());
    }
  };

  // Update input when currentPage changes from external sources
  if (pageInput !== currentPage.toString() && document.activeElement?.tagName !== "INPUT") {
    setPageInput(currentPage.toString());
  }

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between border-border border-t bg-secondary-bg px-3 py-2">
      <div className="flex items-center gap-2">
        <Select
          value={pageSize.toString()}
          options={[
            { value: "10", label: "10" },
            { value: "25", label: "25" },
            { value: "50", label: "50" },
            { value: "100", label: "100" },
            { value: "500", label: "500" },
          ]}
          onChange={(value) => onPageSizeChange(Number(value))}
          size="xs"
          className="min-w-16"
        />
        <span className="ui-font ui-text-sm text-text-lighter">per page</span>
      </div>

      <div className="flex items-center gap-1">
        <Button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          variant="ghost"
          size="xs"
          className="ui-text-sm text-text-lighter hover:text-text disabled:opacity-50"
        >
          ← Prev
        </Button>

        <form onSubmit={handlePageInputSubmit} className="flex items-center gap-1">
          <Input
            type="number"
            value={pageInput}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              handlePageInputChange(e.target.value)
            }
            onBlur={handlePageInputBlur}
            min={1}
            max={totalPages}
            className="ui-font ui-text-sm h-6 w-12 px-1 py-0 text-center"
          />
          <span className="ui-font ui-text-sm text-text-lighter">/ {totalPages}</span>
        </form>

        <Button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          variant="ghost"
          size="xs"
          className="ui-text-sm text-text-lighter hover:text-text disabled:opacity-50"
        >
          Next →
        </Button>
      </div>
    </div>
  );
}
