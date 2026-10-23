import { NavLink } from 'react-router';

const modules = [
  ['Overview', ''], ['Dashboard', '/dashboard'], ['Budget', '/budget'],
  ['Variations', '/variations'], ['Subcontractors', '/subcontractors'], ['Claims', '/claims'],
];

export default function ProjectModuleNav({ projectId }) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  return <nav className="project-modules" aria-label="Project modules">
    {modules.map(([label, suffix]) => <NavLink key={label} to={`${base}${suffix}`} end>{label}</NavLink>)}
  </nav>;
}
