/**
 * Design tokens for the light glassmorphic theme.
 *
 * Chart colours come from a validated palette: the two-series trend uses
 * categorical slot 1 (blue) against status-critical red — that pair passes the
 * lightness, chroma, CVD (ΔE 23.8) and contrast checks on this surface.
 * Severity uses the reserved status palette, which is why every severity mark
 * in the UI is paired with its text label — colour never carries meaning alone.
 */
export const palette = {
  brand: {
    50: '#eef4fd',
    100: '#cde2fb',
    200: '#9ec5f4',
    300: '#6da7ec',
    400: '#3987e5',
    500: '#2a78d6',
    600: '#256abf',
    700: '#1c5cab',
    800: '#184f95',
    900: '#104281',
  },
  ink: {
    primary: '#0b0b0b',
    secondary: '#52514e',
    muted: '#898781',
    grid: '#e1e0d9',
    axis: '#c3c2b7',
  },
  status: {
    good: '#0ca30c',
    warning: '#fab219',
    serious: '#ec835a',
    critical: '#d03b3b',
  },
  severity: {
    critical: '#d03b3b',
    high: '#ec835a',
    medium: '#fab219',
    low: '#0ca30c',
  },
  surface: {
    page: '#f7f9fc',
    chart: '#fcfcfb',
    glass: 'rgba(255, 255, 255, 0.62)',
    glassStrong: 'rgba(255, 255, 255, 0.82)',
    glassBorder: 'rgba(255, 255, 255, 0.75)',
    glassEdge: 'rgba(11, 11, 11, 0.08)',
  },
};

export const severityOrder = ['critical', 'high', 'medium', 'low'];

export const severityLabel = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const findingStatusLabel = {
  open: 'Open',
  triaged: 'Triaged',
  false_positive: 'False positive',
  remediated: 'Remediated',
  accepted_risk: 'Accepted risk',
};

export const scanStatusColor = {
  queued: 'info',
  running: 'primary',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
};

export const roleLabel = {
  admin: 'Administrator',
  security_analyst: 'Security analyst',
  developer: 'Developer',
  viewer: 'Viewer',
};

/**
 * The frosted-panel recipe used by every surface in the app.
 * `radius` is emitted in px on purpose: MUI's `sx` multiplies bare numbers by
 * theme.shape.borderRadius, which would turn 18 into 252px.
 */
export const glass = ({ strong = false, radius = 18, blur = 20 } = {}) => ({
  background: strong ? palette.surface.glassStrong : palette.surface.glass,
  backdropFilter: `blur(${blur}px) saturate(160%)`,
  WebkitBackdropFilter: `blur(${blur}px) saturate(160%)`,
  border: `1px solid ${palette.surface.glassBorder}`,
  borderRadius: `${radius}px`,
  boxShadow: '0 10px 30px -18px rgba(16, 66, 129, 0.45), 0 1px 2px rgba(11, 11, 11, 0.04)',
});
