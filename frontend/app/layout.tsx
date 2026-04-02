export const metadata = {
  title: 'ClipCraft MVP',
  description: 'Local auto-thumbnail generator'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Inter, Arial, sans-serif', background: '#0f1115', color: '#f5f5f5' }}>
        {children}
      </body>
    </html>
  );
}
