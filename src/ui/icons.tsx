import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: ReactNode) {
  return function Icon({ size = 24, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {paths}
      </svg>
    );
  };
}

export const TodayIcon = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </>,
);
export const TripIcon = make(
  <>
    <circle cx="6" cy="18" r="2.2" />
    <circle cx="18" cy="6" r="2.2" />
    <path d="M8 17.2c4.5-1 2.5-6.5 7.2-9.6" />
  </>,
);
export const DocsIcon = make(
  <>
    <rect x="4" y="3" width="13" height="18" rx="2" />
    <circle cx="10.5" cy="10" r="3" />
    <path d="M7.5 16.5h6M20 7v12" />
  </>,
);
export const GlobeIcon = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3Z" />
  </>,
);
export const MoreIcon = make(
  <>
    <circle cx="5" cy="12" r="1.3" />
    <circle cx="12" cy="12" r="1.3" />
    <circle cx="19" cy="12" r="1.3" />
  </>,
);
export const LockIcon = make(
  <>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </>,
);
export const UnlockIcon = make(
  <>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" />
  </>,
);
export const PhoneIcon = make(
  <path d="M5 3.5h3.2l1.6 4-2 1.3a11 11 0 0 0 5.4 5.4l1.3-2 4 1.6V17a2.5 2.5 0 0 1-2.5 2.5C9.6 19.5 4.5 14.4 4.5 8 4.5 5.6 3.5 3.5 5 3.5Z" />,
);
export const ChatIcon = make(<path d="M4 18.5 5.3 15A7.5 7.5 0 1 1 8.6 18l-4.6.5Z" />);
export const PlusIcon = make(<path d="M12 5v14M5 12h14" />);
export const CameraIcon = make(
  <>
    <path d="M4 8h3l1.6-2.5h6.8L17 8h3v11H4Z" />
    <circle cx="12" cy="13" r="3.4" />
  </>,
);
export const ImageIcon = make(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="m20.5 16-5-5-8.5 8.5" />
  </>,
);
export const FileIcon = make(
  <>
    <path d="M6 3h8l4 4v14H6Z" />
    <path d="M14 3v4h4M9 13h6M9 17h6" />
  </>,
);
export const TrashIcon = make(<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />);
export const ShareIcon = make(<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8M5 12.5V20h14v-7.5" />);
export const DownloadIcon = make(<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14" />);
export const UploadIcon = make(<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 20h14" />);
export const ChevronRightIcon = make(<path d="m9.5 5.5 6.5 6.5-6.5 6.5" />);
export const ChevronLeftIcon = make(<path d="M14.5 5.5 8 12l6.5 6.5" />);
export const CloseIcon = make(<path d="M6 6l12 12M18 6 6 18" />);
export const AlertIcon = make(
  <>
    <path d="M12 3.5 21.5 20h-19Z" />
    <path d="M12 10v4.5M12 17.3v.2" />
  </>,
);
export const CheckIcon = make(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const ShieldIcon = make(<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6Z" />);
export const HeartIcon = make(
  <path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10Z" />,
);
export const GearIcon = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
  </>,
);
export const WalletIcon = make(
  <>
    <rect x="3.5" y="6" width="17" height="13" rx="2" />
    <path d="M3.5 9.5h17M15.5 14h2" />
  </>,
);
export const ListIcon = make(<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5l.8.8 1.4-1.6M4.5 12l.8.8 1.4-1.6M4.5 17.5l.8.8 1.4-1.6" />);
export const SpeechIcon = make(
  <>
    <path d="M4 5.5h16v10H10l-4.5 3.5v-3.5H4Z" />
    <path d="M8 10.5h8" />
  </>,
);
export const PersonIcon = make(
  <>
    <circle cx="12" cy="8" r="3.8" />
    <path d="M4.5 20.5c.8-4 3.9-6 7.5-6s6.7 2 7.5 6" />
  </>,
);
export const CloudOffIcon = make(<path d="M3 3l18 18M8.5 7.4A5.5 5.5 0 0 1 17 11.5h.5a3.5 3.5 0 0 1 2.2 6.2M16 18H6.5a4 4 0 0 1-.6-8" />);
export const ExternalIcon = make(<path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v5.5H4.5V7H10" />);
export const EditIcon = make(<path d="M4.5 19.5 5.3 15 15.6 4.7a2 2 0 0 1 2.8 0l.9.9a2 2 0 0 1 0 2.8L9 18.7Z" />);
