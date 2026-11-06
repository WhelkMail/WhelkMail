interface WhelkLogoProps {
  size?: number
  className?: string
}

export function WhelkLogo({ size = 24, className }: WhelkLogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="WhelkMail"
    >
      <path
        strokeWidth="4.5"
        d="M43 12c9 1 15 9 14 18-1 9-9 15-18 14-8-1-14-8-14-16 0-7 6-13 13-13 6 0 11 5 11 11 0 5-4 9-9 9-4 0-7-3-7-7"
      />
      <path strokeWidth="4.5" d="M31 36 13 58c-1.5 2 .5 4.5 3 3.5L35 47" />
      <path strokeWidth="3" d="M53 22c-7 1-13 4-18 9M56 31c-8 2-15 6-20 12" />
    </svg>
  )
}
