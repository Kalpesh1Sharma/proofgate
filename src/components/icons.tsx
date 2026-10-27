import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const baseProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export function LogoMark(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 2.75 19 5.6v5.7c0 4.35-2.86 7.75-7 9.2-4.14-1.45-7-4.85-7-9.2V5.6L12 2.75Z" />
      <path d="M9.25 9.75v4.5M12 8.75v6.5M14.75 9.75v4.5" />
    </svg>
  );
}

export function ReviewIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4 5.5h16" />
      <path d="M4 12h10" />
      <path d="M4 18.5h7" />
      <path d="m16.5 15.5 2 2 3-3.5" />
    </svg>
  );
}

export function FindingsIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M7.5 8.25h9M7.5 12h6M7.5 15.75h4" />
    </svg>
  );
}

export function ReportIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L14 3.5Z" />
      <path d="M14 3.5v5h5" />
      <path d="M8.5 13h7M8.5 16.5h5" />
    </svg>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4 5.5A2 2 0 0 1 6 3.5h5v17H6a2 2 0 0 0-2 2v-17Z" />
      <path d="M20 5.5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2v-17Z" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M8 5.5v13l10-6.5-10-6.5Z" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4.5 12h15" />
      <path d="m14 6.5 5.5 5.5-5.5 5.5" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 3.5v11" />
      <path d="m7.5 10 4.5 4.5 4.5-4.5" />
      <path d="M4.5 18.5v1a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-1" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 3.75 21 19.5H3L12 3.75Z" />
      <path d="M12 9v4.5" />
      <path d="M12 16.5h.01" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="m6 9.5 6 6 6-6" />
    </svg>
  );
}

export function FileCodeIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9L13.5 3.5Z" />
      <path d="M13.5 3.5V9H19" />
      <path d="m10 12.5-2 2 2 2M14 12.5l2 2-2 2" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 2.75 19 5.6v5.7c0 4.35-2.86 7.75-7 9.2-4.14-1.45-7-4.85-7-9.2V5.6L12 2.75Z" />
    </svg>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4.5 6.5h15" />
      <path d="M9 6.5V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5" />
      <path d="M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5" />
      <path d="M10.5 10v6.5M13.5 10v6.5" />
    </svg>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 20.5v-11" />
      <path d="m7.5 14 4.5-4.5 4.5 4.5" />
      <path d="M4.5 7.5v-2a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export function ShieldCheckIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 2.75 19 5.6v5.7c0 4.35-2.86 7.75-7 9.2-4.14-1.45-7-4.85-7-9.2V5.6L12 2.75Z" />
      <path d="m9 11.75 2.1 2.1L15 10.25" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.5V12l3 1.75" />
    </svg>
  );
}

export function XCircleIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="m9.5 9.5 5 5M14.5 9.5l-5 5" />
    </svg>
  );
}

export function MinusCircleIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M8.75 12h6.5" />
    </svg>
  );
}

export function DatabaseIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <ellipse cx="12" cy="6" rx="7.25" ry="2.75" />
      <path d="M4.75 6v12c0 1.52 3.25 2.75 7.25 2.75s7.25-1.23 7.25-2.75V6" />
      <path d="M4.75 12c0 1.52 3.25 2.75 7.25 2.75s7.25-1.23 7.25-2.75" />
    </svg>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 3.5l1.6 4.4 4.4 1.6-4.4 1.6L12 15.5l-1.6-4.4L6 9.5l4.4-1.6L12 3.5Z" />
      <path d="M18.5 15.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9Z" />
    </svg>
  );
}