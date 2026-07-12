import { ArrowLeftIcon as ArrowLeft, ArrowRightIcon as ArrowRight } from "@/ui/icons";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import Select from "@/ui/select";
import { parseQueryResultPageInput } from "../lib/query-result-pagination";

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
    const page = parseQueryResultPageInput(pageInput, totalPages);
    if (page !== null) {
      onPageChange(page);
    } else {
      setPageInput(currentPage.toString());
    }
  };

  const handlePageInputBlur = () => {
    if (parseQueryResultPageInput(pageInput, totalPages) === null) {
      setPageInput(currentPage.toString());
    }
  };

  useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between border-border border-t bg-secondary-bg px-3 py-2">
      <div className="flex items-center gap-2">
        <Select
          value={pageSize.toString()}
          aria-label="Rows per page"
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
        <span className="font-sans ui-text-sm text-text-lighter">per page</span>
      </div>

      <div className="flex items-center gap-1">
        <Button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          variant="ghost"
          compact
          className="text-text-lighter hover:text-text disabled:opacity-50"
          aria-label="Previous page"
          tooltip="Previous page"
        >
          <ArrowLeft />
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
            aria-label="Current page"
            className="font-sans ui-text-sm h-6 w-12 px-1 py-0 text-center"
          />
          <span className="font-sans ui-text-sm text-text-lighter">/ {totalPages}</span>
        </form>

        <Button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          variant="ghost"
          compact
          className="text-text-lighter hover:text-text disabled:opacity-50"
          aria-label="Next page"
          tooltip="Next page"
        >
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
