import AccountPage from './AccountPage.jsx';
import ProfileForm from './ProfileForm.jsx';
import OrdersList from './OrdersList.jsx';
import AddressBook from './AddressBook.jsx';
import SecuritySettings from './SecuritySettings.jsx';
import NotificationPrefs from './NotificationPrefs.jsx';

// Route-config style (createBrowserRouter / useRoutes) instead of JSX.
export const accountRoutes = [
  {
    path: '/account',
    element: AccountPage,
    children: [
      { index: true, element: ProfileForm },
      { path: 'orders', element: OrdersList },
      { path: 'addresses', element: AddressBook },
      { path: 'security', element: SecuritySettings },
      { path: 'notifications', element: NotificationPrefs },
    ],
  },
];
