"""HTTP routing for project modules; transport protection remains in server.py."""
from .contracts import Problem, identity
from .project_contracts import COLLECTIONS


def owns(path):
    return path in ("/v1/workspaces", "/v1/project-items", "/v1/search", "/v1/capabilities") or path.startswith(("/v1/workspaces/", "/v1/project-operations/"))


def parameters(query, allowed):
    if set(query)-set(allowed):
        raise Problem("invalid_query", "Unknown query parameter", 400)
    result = {}
    for key, values in query.items():
        if len(values) != 1:
            raise Problem("invalid_query", "Repeated query parameter", 400)
        value = values[0]
        if key in ("limit", "before", "version"):
            if not value.isascii() or not value.isdigit() or len(value) > 10:
                raise Problem("invalid_query", "Expected positive bounded integer", 400)
            result[key] = int(value)
        elif key in ("include_test", "include_archived"):
            if value not in ("true", "false"):
                raise Problem("invalid_query", "Expected true/false", 400)
            result[key] = value == "true"
        else:
            result[key] = value
    return result


def dispatch(store, method, path, query, value=None):
    projects = store.projects
    parts = path.strip("/").split("/")
    if method == "GET" and path == "/v1/capabilities":
        parameters(query, ())
        return 200, {"schema_version": 1, "database_version": 3, "deployment": "single_user_loopback",
                     "modules": ["discoveries", "attention", "workspaces", "sources", "artifacts", "versions", "stages", "project_board", "feedback", "plans", "tasks", "records", "canvases", "search", "operation_receipts"],
                     "source_access": "explicit_bounded_read_only", "session_links": "manual",
                     "pdf_page_jump": "manual", "scheduler": "external_harness"}
    if method == "GET" and len(parts) == 3 and parts[:2] == ["v1", "project-operations"]:
        parameters(query, ())
        result = projects.operation(parts[2])
        if result is None:
            raise Problem("not_found", "Operation has no durable successful receipt", 404)
        return 200, result
    if method == "GET" and path in ("/v1/search", "/v1/project-items"):
        params = parameters(query, ("limit", "before", "include_test", "include_archived", "workspace_id", "kind", "q"))
        if path == "/v1/search" and "q" not in params:
            raise Problem("invalid_query", "Search requires q", 400)
        return 200, projects.list_items(**params)
    if path == "/v1/workspaces":
        if method == "GET":
            return 200, projects.list_workspaces(**parameters(query, ("limit", "before", "include_test", "status")))
        if method == "POST":
            parameters(query, ())
            return projects.save_workspace(value)
    if len(parts) >= 3 and parts[:2] == ["v1", "workspaces"]:
        workspace_id = identity(parts[2], "workspace_id")
        if len(parts) == 3:
            if method == "GET":
                return 200, projects.workspace(workspace_id, **parameters(query, ("version",)))
            if method == "POST":
                parameters(query, ())
                return projects.save_workspace(value, workspace_id)
        if len(parts) == 4 and parts[3] == "overview" and method == "GET":
            parameters(query, ())
            return 200, projects.overview(workspace_id)
        if len(parts) == 4 and parts[3] == "board" and method == "GET":
            return 200, projects.board(workspace_id, **parameters(query, ("limit", "before")))
        if len(parts) == 4 and parts[3] == "refresh" and method == "POST":
            parameters(query, ())
            return projects.refresh(workspace_id, value)
        if len(parts) == 4 and parts[3] == "compare" and method == "GET":
            params = parameters(query, ("left", "right", "left_artifact", "right_artifact"))
            if not {"left", "right"} <= set(params):
                raise Problem("invalid_query", "Specify left and right version IDs", 400)
            return 200, projects.compare_versions(workspace_id, params["left"], params["right"], params.get("left_artifact"), params.get("right_artifact"))
        if len(parts) >= 4 and parts[3] in COLLECTIONS:
            kind = COLLECTIONS[parts[3]]
            if len(parts) == 4:
                if method == "GET":
                    params = parameters(query, ("limit", "before", "include_archived", "include_test", "q"))
                    return 200, projects.list_items(workspace_id, kind, **params)
                if method == "POST" and kind != "source":
                    parameters(query, ())
                    return projects.save_item(workspace_id, value, kind)
            if len(parts) == 5 and method == "GET":
                params = parameters(query, ("version",))
                return 200, projects.item(workspace_id, parts[4], expected_kind=kind, **params)
            if len(parts) == 6 and parts[5] == "inspect" and kind == "artifact" and method == "GET":
                return 200, projects.inspect_artifact(workspace_id, parts[4], **parameters(query, ("version",)))
            if len(parts) == 6 and parts[5] == "preview" and kind == "artifact" and method == "GET":
                return 200, projects.preview_artifact(workspace_id, parts[4], **parameters(query, ("version",)))
    raise Problem("not_found", "Unknown project route or method", 404)
