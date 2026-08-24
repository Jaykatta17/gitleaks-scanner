import { useMemo, useState } from 'react';
import { Link as RouterLink, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Avatar,
  Badge,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  AppBar,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/SpaceDashboard';
import FolderIcon from '@mui/icons-material/FolderSpecial';
import RadarIcon from '@mui/icons-material/Radar';
import BugReportIcon from '@mui/icons-material/BugReport';
import PeopleIcon from '@mui/icons-material/People';
import HistoryIcon from '@mui/icons-material/ManageSearch';
import SettingsIcon from '@mui/icons-material/Tune';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/AccountCircle';
import ShieldIcon from '@mui/icons-material/GppGood';
import { useAuth } from '../auth/AuthContext.jsx';
import { roleLabel, glass, palette } from '../theme/tokens.js';

const DRAWER_WIDTH = 264;

const NAV_ITEMS = [
  { label: 'Dashboard', to: '/', icon: DashboardIcon, exact: true },
  { label: 'Applications', to: '/applications', icon: FolderIcon },
  { label: 'Scans', to: '/scans', icon: RadarIcon },
  { label: 'Findings', to: '/findings', icon: BugReportIcon },
  { label: 'Users', to: '/users', icon: PeopleIcon, capability: 'manageUsers' },
  { label: 'Audit trail', to: '/audit', icon: HistoryIcon, capability: 'viewAudit' },
  { label: 'Settings', to: '/settings', icon: SettingsIcon, capability: 'editSettings' },
];

const initials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

export const AppLayout = () => {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const items = useMemo(() => NAV_ITEMS.filter((item) => !item.capability || can(item.capability)), [can]);

  const handleLogout = async () => {
    setMenuAnchor(null);
    await logout();
    navigate('/login', { replace: true });
  };

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2.5, py: 2.5 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 2.5,
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            background: `linear-gradient(135deg, ${palette.brand[500]}, ${palette.brand[300]})`,
            boxShadow: `0 10px 22px -12px ${alpha(palette.brand[700], 0.9)}`,
          }}
        >
          <ShieldIcon />
        </Box>
        <Box>
          <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
            Sentinel
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Secret scanning console
          </Typography>
        </Box>
      </Stack>
      <Divider sx={{ mx: 2, opacity: 0.6 }} />

      <List sx={{ px: 1.5, py: 1.5, flex: 1 }}>
        {items.map((item) => {
          const Icon = item.icon;
          const selected = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
          return (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              selected={selected}
              onClick={() => setMobileOpen(false)}
              sx={{ mb: 0.5, color: selected ? 'primary.dark' : 'text.secondary' }}
            >
              <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText primaryTypographyProps={{ fontWeight: selected ? 700 : 500, fontSize: '0.92rem' }}>
                {item.label}
              </ListItemText>
            </ListItemButton>
          );
        })}
      </List>

      <Box sx={{ p: 2 }}>
        <Box sx={{ ...glass({ strong: true, radius: 14 }), p: 1.75 }}>
          <Typography variant="overline" color="text.secondary">
            Signed in as
          </Typography>
          <Typography variant="subtitle1" fontWeight={600} noWrap>
            {user?.displayName}
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={roleLabel[user?.role] || user?.role} color="primary" variant="outlined" />
            <Chip
              size="small"
              label={user?.authProvider === 'ldap' ? 'Directory' : 'Local'}
              variant="outlined"
              sx={{ color: 'text.secondary' }}
            />
          </Stack>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        sx={{
          width: { lg: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { lg: `${DRAWER_WIDTH}px` },
          zIndex: theme.zIndex.drawer + 1,
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          {!isDesktop && (
            <IconButton edge="start" onClick={() => setMobileOpen((open) => !open)} aria-label="Open navigation">
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h5" sx={{ flexGrow: 1 }} noWrap>
            {items.find((item) => (item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to)))?.label ||
              'Sentinel Console'}
          </Typography>

          {user?.mustChangePassword && (
            <Tooltip title="Your password must be changed">
              <Chip
                component={RouterLink}
                to="/profile"
                clickable
                color="warning"
                size="small"
                label="Password change required"
              />
            </Tooltip>
          )}

          <Tooltip title="Account">
            <IconButton onClick={(event) => setMenuAnchor(event.currentTarget)} sx={{ ml: 0.5 }}>
              <Badge color="error" variant="dot" invisible={!user?.mustChangePassword}>
                <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: '0.85rem' }}>
                  {initials(user?.displayName)}
                </Avatar>
              </Badge>
            </IconButton>
          </Tooltip>
          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <MenuItem component={RouterLink} to="/profile" onClick={() => setMenuAnchor(null)}>
              <ListItemIcon>
                <PersonIcon fontSize="small" />
              </ListItemIcon>
              Profile & security
            </MenuItem>
            <Divider />
            <MenuItem onClick={handleLogout}>
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { lg: DRAWER_WIDTH }, flexShrink: { lg: 0 } }}>
        <Drawer
          variant={isDesktop ? 'permanent' : 'temporary'}
          open={isDesktop || mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}
        >
          {!isDesktop && <Toolbar />}
          {drawer}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, px: { xs: 2, md: 4 }, pb: 6 }}>
        <Toolbar />
        <Box sx={{ pt: 3 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
};

export default AppLayout;
