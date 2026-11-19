import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'

interface RustInfoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onTryRust: () => void;
  repository: string;
  isRustSelected: boolean;
}

const points = ['memorySafety', 'bugsFixed', 'sameFeatures', 'switchBack'];

export default function RustInfoDialog({ isOpen, onClose, onTryRust, repository, isRustSelected }: RustInfoDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rust-info-title"
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 text-left shadow-xl dark:bg-gray-800"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-6 w-6" />
        </button>
        <div className="mb-2 text-4xl">🦀</div>
        <h2 id="rust-info-title" className="mb-2 text-xl font-bold">{t('rustInfo.title')}</h2>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">{t('rustInfo.intro')}</p>
        <ul className="mb-4 space-y-3 text-sm">
          {points.map((point) => (
            <li key={point} className="flex gap-2">
              <span className="text-orange-600 dark:text-orange-400">✔</span>
              <span>
                <span className="font-semibold">{t(`rustInfo.points.${point}.title`)}</span>{' '}
                <span className="text-gray-600 dark:text-gray-300">{t(`rustInfo.points.${point}.description`)}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {t('rustInfo.experimentalNote')}{' '}
          <a
            href={`${repository}/issues`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline"
          >
            {t('rustInfo.reportIssues')}
          </a>
        </div>
        <div className="flex gap-2">
          <Button
            className="flex-1 bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-100"
            onClick={onTryRust}
            disabled={isRustSelected}
          >
            {isRustSelected ? `✓ ${t('rustInfo.rustSelected')}` : t('rustInfo.tryRust')}
          </Button>
          <Button className="flex-1" variant="outline" onClick={onClose}>
            {isRustSelected ? t('rustInfo.ok') : t('rustInfo.close')}
          </Button>
        </div>
      </div>
    </div>
  )
}
