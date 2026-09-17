import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// 角丸・太さ・secondary の配色はテーマ変数（app/globals.css の --ui-*）で店舗画面/その他を切り替える
const buttonVariants = cva(
  'ui-btn inline-flex items-center justify-center gap-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-white hover:bg-primary-deep',
        /** 店舗画面では淡いアイリス地（プロトタイプの .btn.ghost）、その他は白地＋罫線 */
        secondary: 'ui-btn-secondary',
        /** 白地に罫線 */
        outline: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
        ghost: 'text-navy hover:bg-gray-100',
        danger: 'bg-danger text-white hover:bg-red-700',
        success: 'bg-success text-white hover:bg-green-800',
        navy: 'bg-navy text-white hover:bg-navy-soft',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        /** タブレットPOS向けの大きなタッチターゲット */
        pos: 'h-14 px-6 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type, ...props }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
