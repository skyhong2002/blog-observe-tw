import { permanentRedirect } from 'next/navigation';

// The author list was retired: /blogs/ shows each blog's author count, and each blog page names its authors.
// Old links (including ?author=) land on the directory.
export const dynamic = 'force-dynamic';

export default function AuthorsPage() {
  permanentRedirect('/blogs/');
}
