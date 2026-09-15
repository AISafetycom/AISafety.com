import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Field map poster – AISafety.com',
  robots: {
    index: false,
    follow: false,
  },
}

export default function PosterLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <>
      <style>{`body { background-image: none !important; background-color: #000 !important; }`}</style>
      {children}
    </>
  )
}
