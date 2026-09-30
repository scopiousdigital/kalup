import { MissingPage } from '../_components/missing-page'

export { metadata } from '../not-found'

// Inside the (site) layout, which already draws the header and footer.
export default function NotFound() {
  return <MissingPage />
}
