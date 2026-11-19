import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type FirmwareVariant = {
  id: string;
  label: string;
  repository: string;
  r2BaseUrl: string;
  experimental?: boolean;
}

type FirmwareVariantToggleProps = {
  variants: FirmwareVariant[];
  value: string;
  onValueChange: (value: string) => void;
  onShowInfo: () => void;
  disabled?: boolean;
}

// Segmented control to pick the firmware implementation (C/C++ or Rust)
export default function FirmwareVariantToggle({ variants, value, onValueChange, onShowInfo, disabled }: FirmwareVariantToggleProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1 text-left">
      <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
        <span>{t('variant.label')}</span>
        <button
          type="button"
          className="font-medium text-orange-600 hover:underline dark:text-orange-400"
          onClick={onShowInfo}
        >
          {t('variant.whyRust')} 🦀
        </button>
      </div>
      <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-md border border-input p-1">
        {variants.map((variant) => {
          const selected = variant.id === value;
          return (
            <button
              key={variant.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onValueChange(variant.id)}
              className={cn(
                'flex flex-col items-center rounded px-2 py-1.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
                selected
                  ? variant.experimental
                    ? 'bg-orange-100 text-orange-900 ring-1 ring-orange-500 dark:bg-orange-950 dark:text-orange-100'
                    : 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <span>{variant.id === 'rust' ? `🦀 ${variant.label}` : variant.label}</span>
              <span className={cn('text-xs font-normal', selected ? 'opacity-90' : 'text-gray-500 dark:text-gray-400')}>
                {variant.experimental ? t('variant.experimental') : t('variant.stable')}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  )
}
