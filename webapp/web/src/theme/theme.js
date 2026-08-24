import { createTheme, alpha } from '@mui/material/styles';
import { palette, glass } from './tokens.js';

/**
 * A deliberately light-only theme: frosted surfaces over a soft gradient read
 * as "glass" precisely because the plane behind them is bright.
 */
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: palette.brand[500], light: palette.brand[300], dark: palette.brand[700], contrastText: '#ffffff' },
    secondary: { main: '#4a3aa7', contrastText: '#ffffff' },
    success: { main: palette.status.good },
    warning: { main: palette.status.warning },
    error: { main: palette.status.critical },
    info: { main: palette.brand[400] },
    background: { default: palette.surface.page, paper: palette.surface.glass },
    text: { primary: palette.ink.primary, secondary: palette.ink.secondary, disabled: palette.ink.muted },
    divider: alpha(palette.ink.primary, 0.08),
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    h1: { fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.6rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h3: { fontSize: '1.3rem', fontWeight: 600, letterSpacing: '-0.01em' },
    h4: { fontSize: '1.1rem', fontWeight: 600 },
    h5: { fontSize: '1rem', fontWeight: 600 },
    h6: { fontSize: '0.95rem', fontWeight: 600 },
    subtitle2: { fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.04em' },
    body2: { fontSize: '0.875rem' },
    button: { textTransform: 'none', fontWeight: 600 },
    overline: { letterSpacing: '0.14em', fontWeight: 600, fontSize: '0.68rem' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ':root': { colorScheme: 'light' },
        body: {
          minHeight: '100vh',
          backgroundColor: palette.surface.page,
          // Fixed colour wash: the glass panels need something to refract.
          backgroundImage: `radial-gradient(1200px 780px at 6% -12%, ${alpha(palette.brand[200], 0.85)} 0%, transparent 62%),
             radial-gradient(1000px 680px at 100% -5%, ${alpha('#d9c8ff', 0.8)} 0%, transparent 58%),
             radial-gradient(900px 760px at 45% 108%, ${alpha('#bfe9d8', 0.75)} 0%, transparent 62%),
             radial-gradient(700px 520px at 88% 82%, ${alpha('#ffd9c7', 0.55)} 0%, transparent 60%)`,
          backgroundAttachment: 'fixed',
        },
        '::-webkit-scrollbar': { width: 10, height: 10 },
        '::-webkit-scrollbar-thumb': { background: alpha(palette.ink.primary, 0.18), borderRadius: 8 },
        '::-webkit-scrollbar-track': { background: 'transparent' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        rounded: { borderRadius: 16 },
      },
    },
    MuiCard: { styleOverrides: { root: { ...glass(), overflow: 'hidden' } } },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'transparent' },
      styleOverrides: {
        root: {
          ...glass({ radius: 0, blur: 22 }),
          borderLeft: 'none',
          borderRight: 'none',
          borderTop: 'none',
          boxShadow: '0 6px 24px -20px rgba(16, 66, 129, 0.5)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: { ...glass({ radius: 0, blur: 24 }), borderTop: 'none', borderBottom: 'none', borderLeft: 'none' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 12, paddingInline: 18 },
        containedPrimary: {
          background: `linear-gradient(135deg, ${palette.brand[500]}, ${palette.brand[400]})`,
          boxShadow: `0 8px 20px -12px ${alpha(palette.brand[700], 0.9)}`,
          '&:hover': { background: `linear-gradient(135deg, ${palette.brand[600]}, ${palette.brand[500]})` },
        },
        outlined: { borderColor: alpha(palette.ink.primary, 0.16), backgroundColor: alpha('#ffffff', 0.5) },
      },
    },
    MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: alpha('#ffffff', 0.7),
          borderRadius: 12,
          '& fieldset': { borderColor: alpha(palette.ink.primary, 0.12) },
          '&:hover fieldset': { borderColor: alpha(palette.brand[500], 0.4) },
        },
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 600, borderRadius: 8 } } },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: alpha('#0b0b0b', 0.88),
          backdropFilter: 'blur(6px)',
          fontSize: '0.78rem',
          borderRadius: 8,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottomColor: alpha(palette.ink.primary, 0.07) },
        head: { fontWeight: 600, color: palette.ink.secondary, backgroundColor: 'transparent' },
      },
    },
    MuiDialog: { styleOverrides: { paper: { ...glass({ strong: true, radius: 20 }) } } },
    MuiMenu: { styleOverrides: { paper: { ...glass({ strong: true, radius: 14 }) } } },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          '&.Mui-selected': {
            backgroundColor: alpha(palette.brand[500], 0.14),
            '&:hover': { backgroundColor: alpha(palette.brand[500], 0.2) },
          },
        },
      },
    },
    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 999, height: 6 } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 12, backdropFilter: 'blur(8px)' } } },
  },
});

export default theme;
