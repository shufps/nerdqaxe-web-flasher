import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"

type SelectorProps = {
  onValueChange: (value: string) => void;
  disabled?: boolean;
  values?: string[];
  placeholder?: string;
  value?: string;
}

export default function BoardVersionSelector({ onValueChange, disabled, placeholder = '', values = [], value }: SelectorProps) {
  return (
    <Select value={value === '' ? undefined : value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="overflow-y-auto max-h-[20rem]">
        {values.map((value) => (
          <SelectItem key={value} value={value}>
            {value}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
