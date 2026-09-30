import { notFound } from 'next/navigation'

// Any URL no other route matches lands here, so its 404 renders inside the (site) layout. Next and vinext then agree:
// left to the root not-found, vinext wraps it in this layout and Next does not.
export default function Missing() {
  notFound()
}
