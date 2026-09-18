/**
 * Icon set.
 *
 * Hand-drawn inline SVGs rather than an icon package: this is about twenty
 * glyphs, and pulling in a library for them would add a dependency, a bundle
 * cost and a build step for no benefit. All are 24×24, `currentColor`,
 * 1.75-weight strokes with round caps — one visual language.
 *
 * They are decorative by default (`aria-hidden`); pass a `title` when an icon
 * is the only label for a control.
 */

export interface IconProps {
  className?: string;
  /** Accessible name. Omit for decorative icons next to visible text. */
  title?: string;
}

function Svg({ className = 'h-5 w-5', title, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IconHome = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20a1 1 0 0 0 1 1H9.5v-5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5h3a1 1 0 0 0 1-1V9.5" />
  </Svg>
);

export const IconReport = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 8v5" />
    <path d="M12 16.5h.01" />
    <path d="M10.3 3.8 2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" />
  </Svg>
);

export const IconCases = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3.5" y="6.5" width="17" height="13" rx="2" />
    <path d="M8.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 5v1.5" />
    <path d="M3.5 11.5h17" />
  </Svg>
);

export const IconRewards = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 9.5h16v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-9Z" />
    <path d="M3 6.5h18v3H3z" />
    <path d="M12 6.5v13.5" />
    <path d="M12 6.5S10.5 3 8.5 3a2 2 0 0 0 0 4h3.5Z" />
    <path d="M12 6.5S13.5 3 15.5 3a2 2 0 0 1 0 4H12Z" />
  </Svg>
);

export const IconBell = (props: IconProps) => (
  <Svg {...props}>
    <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" />
    <path d="M13.7 19a2 2 0 0 1-3.4 0" />
  </Svg>
);

export const IconUser = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </Svg>
);

export const IconSettings = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z" />
  </Svg>
);

export const IconSignOut = (props: IconProps) => (
  <Svg {...props}>
    <path d="M15 4.5h3A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5h-3" />
    <path d="M10.5 15.5 14 12l-3.5-3.5" />
    <path d="M14 12H4.5" />
  </Svg>
);

export const IconArrowRight = (props: IconProps) => (
  <Svg {...props}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </Svg>
);

export const IconArrowLeft = (props: IconProps) => (
  <Svg {...props}>
    <path d="M19 12H5" />
    <path d="m11 18-6-6 6-6" />
  </Svg>
);

export const IconChevronRight = (props: IconProps) => (
  <Svg {...props}>
    <path d="m9 5 7 7-7 7" />
  </Svg>
);

export const IconChevronDown = (props: IconProps) => (
  <Svg {...props}>
    <path d="m5 9 7 7 7-7" />
  </Svg>
);

export const IconCheck = (props: IconProps) => (
  <Svg {...props}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Svg>
);

export const IconClose = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const IconMenu = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export const IconLocation = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </Svg>
);

export const IconCamera = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 8.5h2.8l1.4-2h7.6l1.4 2H20a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18v-8A1.5 1.5 0 0 1 4 8.5Z" />
    <circle cx="12" cy="13.5" r="3.2" />
  </Svg>
);

export const IconClock = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </Svg>
);

export const IconSparkle = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9 12 3.5Z" />
    <path d="M18.5 3.5v3M20 5h-3" />
  </Svg>
);

export const IconShield = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 3 5 6v5.5c0 4.4 2.9 8.2 7 9.5 4.1-1.3 7-5.1 7-9.5V6l-7-3Z" />
    <path d="m9.5 12 1.8 1.8 3.4-3.6" />
  </Svg>
);

export const IconDocument = (props: IconProps) => (
  <Svg {...props}>
    <path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" />
    <path d="M13.5 3.5V8H18" />
    <path d="M9 13h6M9 16.5h4" />
  </Svg>
);

export const IconSend = (props: IconProps) => (
  <Svg {...props}>
    <path d="M20.5 3.5 10.5 13.5" />
    <path d="M20.5 3.5 14 20.5l-3.5-7-7-3.5 17-6.5Z" />
  </Svg>
);

export const IconEscalate = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 19V5" />
    <path d="m6 11 6-6 6 6" />
  </Svg>
);

export const IconUsers = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.6a3.2 3.2 0 0 1 0 5.8" />
    <path d="M17.5 14.6a5.5 5.5 0 0 1 3 4.9" />
  </Svg>
);

export const IconStar = (props: IconProps) => (
  <Svg {...props}>
    <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8L12 3.5Z" />
  </Svg>
);

export const IconRefresh = (props: IconProps) => (
  <Svg {...props}>
    <path d="M20 11.5a8 8 0 1 0-.8 4.5" />
    <path d="M20 5v6h-6" />
  </Svg>
);

export const IconInfo = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </Svg>
);

/** Category glyphs, keyed by the domain's category ids. */
export const CATEGORY_ICON: Record<string, (props: IconProps) => React.ReactElement> = {
  ROAD_DAMAGE: (props) => (
    <Svg {...props}>
      <path d="M7 3.5 4.5 20.5" />
      <path d="M17 3.5 19.5 20.5" />
      <path d="M12 4v3M12 10.5v3M12 17v3" />
    </Svg>
  ),
  GARBAGE_SANITATION: (props) => (
    <Svg {...props}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4A1.3 1.3 0 0 1 14.5 4.8V7" />
      <path d="M6.5 7l.9 12.2a1.4 1.4 0 0 0 1.4 1.3h6.4a1.4 1.4 0 0 0 1.4-1.3L17.5 7" />
      <path d="M10.5 11v6M13.5 11v6" />
    </Svg>
  ),
  STREETLIGHT: (props) => (
    <Svg {...props}>
      <path d="M12 12.5v8" />
      <path d="M8.5 20.5h7" />
      <path d="M7.5 5.5h9l1.8 5.2a1 1 0 0 1-.95 1.3H6.65a1 1 0 0 1-.95-1.3L7.5 5.5Z" />
      <path d="M12 2.5v3" />
    </Svg>
  ),
  WATER_SEWERAGE: (props) => (
    <Svg {...props}>
      <path d="M12 3.2s6 6.3 6 10.3a6 6 0 0 1-12 0c0-4 6-10.3 6-10.3Z" />
      <path d="M9.2 14.2a2.9 2.9 0 0 0 2.8 2.8" />
    </Svg>
  ),
  PUBLIC_SAFETY_HAZARD: (props) => (
    <Svg {...props}>
      <path d="M12 3 4 19.5h16L12 3Z" />
      <path d="M12 9.5v4.5" />
      <path d="M12 17h.01" />
    </Svg>
  ),
  OTHER: (props) => (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.8 9.5a2.3 2.3 0 1 1 3.1 2.2c-.6.3-.9.8-.9 1.4v.4" />
      <path d="M12 16.5h.01" />
    </Svg>
  ),
};

export function CategoryIcon({ categoryId, className }: { categoryId: string; className?: string }) {
  const Icon = CATEGORY_ICON[categoryId] ?? CATEGORY_ICON.OTHER!;
  return <Icon className={className} />;
}
