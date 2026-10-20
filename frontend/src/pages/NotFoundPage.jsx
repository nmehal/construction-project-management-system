import { Link } from 'react-router';

export default function NotFoundPage() {
  return (
    <section className="page-panel" aria-labelledby="not-found-title">
      <p className="eyebrow">404</p>
      <h1 id="not-found-title">Not Found</h1>
      <p>The page you requested does not exist.</p>
      <Link className="text-link" to="/">Return home</Link>
    </section>
  );
}
