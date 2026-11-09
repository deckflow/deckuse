#!/usr/bin/env python3
"""Collect a read-only, release-keyed Deckuse schema; slice it locally by scenario."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

SKILL = Path(__file__).resolve().parents[1]


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def invoke(binary, args, logs, label):
    try:
        result = subprocess.run([binary, *args], capture_output=True, timeout=30)
        out, err, code = result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired as ex:
        out, err, code = ex.stdout or b'', ex.stderr or b'', 'timeout'
    (logs / (label + '.stdout')).write_bytes(out)
    (logs / (label + '.stderr')).write_bytes(err)
    write_json(logs / (label + '.process.json'), {'argv': [binary, *args], 'returncode': code})
    if code != 0:
        raise ValueError(f'{label} failed ({code}); see {logs}')
    return out


def resolve_ref(value, defs):
    seen = set()
    while isinstance(value, dict) and '$ref' in value:
        ref = value['$ref']
        if not ref.startswith('#/$defs/') or ref in seen:
            raise ValueError(f'Unsupported or cyclic discriminator reference: {ref}')
        seen.add(ref)
        value = defs[ref.split('/')[-1]]
    return value


def command_map(schema):
    if not isinstance(schema, dict) or not isinstance(schema.get('$defs', {}), dict) or not isinstance(schema.get('oneOf', []), list):
        raise ValueError('Unknown full-schema structure; inspect saved schema or use targeted CLI schema')
    defs = schema.get('$defs', {})
    commands = {}
    for branch in schema.get('oneOf', []):
        branch = resolve_ref(branch, defs)
        if not isinstance(branch, dict):
            raise ValueError('Schema command branch must be an object')
        typ = resolve_ref(branch.get('properties', {}).get('type', {}), defs).get('const')
        if typ:
            commands[typ] = branch
    if not commands:
        raise ValueError('Unknown full-schema structure; inspect saved schema or use targeted CLI schema')
    return commands


def validate_data(data, version_display):
    if not isinstance(data, dict):
        raise ValueError('Schema metadata must be an object')
    for key in ['cliVersion', 'protocolVersion', 'edition']:
        if not isinstance(data.get(key), str) or not data[key]:
            raise ValueError(f'Schema metadata missing valid {key}')
    display_version = re.search(r'\b(\d+\.\d+\.\d+(?:-[\w.-]+)?)\b', version_display)
    display_edition = re.search(r'edition=([\w-]+)', version_display)
    if display_version and display_version.group(1) != data['cliVersion']:
        raise ValueError('Schema and selected CLI report different versions')
    if display_edition and display_edition.group(1) != data['edition']:
        raise ValueError('Schema and selected CLI report different editions')
    if not isinstance(data.get('schema'), dict):
        raise ValueError('Schema metadata missing valid schema')
    command_map(data['schema'])


def slice_schema(schema, roots):
    defs, reachable = schema.get('$defs', {}), {}

    def walk(node):
        if isinstance(node, dict):
            ref = node.get('$ref')
            if ref:
                if not ref.startswith('#/$defs/'):
                    raise ValueError(f'Unsupported schema reference: {ref}')
                key = ref.split('/')[-1]
                if key not in reachable:
                    reachable[key] = defs[key]
                    walk(defs[key])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(roots)
    return {'$schema': schema.get('$schema'), 'oneOf': roots, '$defs': reachable}


def operation_fields(commands, selected):
    """Index top-level fields without implying nested fields are interchangeable."""
    protocol = {'version', 'requestId', 'workspaceId', 'transactionId', 'dryRun', 'expectRevision', 'reason'}
    return {typ: {
        'fields': [key for key in commands[typ].get('properties', {}) if key not in protocol],
        'required': [key for key in commands[typ].get('required', []) if key not in protocol],
        'additionalProperties': commands[typ].get('additionalProperties', True),
    } for typ in selected}


def main():
    manifest = json.loads((SKILL / 'manifest.json').read_text())
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scenario', required=True, choices=list(manifest['scenarios']))
    parser.add_argument('--format', required=True, choices=['pptx', 'docx'])
    parser.add_argument('--cache-dir', required=True, type=Path)
    parser.add_argument('--binary', default='deckuse')
    parser.add_argument('--types', nargs='*', default=[])
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    scenario_name = args.scenario
    override = manifest.get('formatOverrides', {}).get(args.format, {}).get(scenario_name)
    if override:
        scenario_name = next(name for name, entry in manifest['scenarios'].items() if entry['path'] == override)
    scenario = manifest['scenarios'][scenario_name]
    if args.format not in scenario['formats']:
        raise ValueError(f'{args.scenario} does not handle {args.format}; choose a format-specific workflow')
    selected = shutil.which(args.binary)
    if not selected:
        raise ValueError('Deckuse not found; select an installed binary or follow the host installation policy')
    binary = Path(selected).resolve()
    cache = args.cache_dir.expanduser().resolve()
    cache.mkdir(parents=True, exist_ok=True)
    logs = Path(tempfile.mkdtemp(prefix='query-', dir=cache))
    version = invoke(str(binary), ['--version'], logs, 'version').decode().strip()
    identity = {'binary': str(binary), 'version': version, 'binarySha256': hashlib.sha256(binary.read_bytes()).hexdigest()}
    for parent in [binary.parent, binary.parent.parent]:
        if (parent / 'package.json').is_file():
            for relative in ['package.json', 'schema/command.schema.json']:
                file = parent / relative
                if file.is_file():
                    identity[relative] = hashlib.sha256(file.read_bytes()).hexdigest()
            break
    required_types = scenario['schemaTypes']
    requested = list(dict.fromkeys(required_types + args.types))
    key = hashlib.sha256(json.dumps([identity, args.scenario, args.format, requested], sort_keys=True).encode()).hexdigest()
    snapshot_path = cache / (key + '.snapshot.json')
    hit, data = False, None
    if snapshot_path.exists() and not args.refresh:
        try:
            saved = json.loads(snapshot_path.read_text())
            if saved['identity'] == identity:
                data = saved['data']
                validate_data(data, version)
                hit = True
        except (ValueError, KeyError, TypeError):
            data = None
    if data is None:
        context = {}
        try:
            response = json.loads(invoke(str(binary), [
                'agent-context', '--scenario', args.scenario, '--format', args.format,
                '--include-schema', '--json'
            ], logs, 'agent-context'))
            if response.get('ok'):
                context = response['data']
        except ValueError:
            # Older CLIs may lack agent-context. Keep the failure in process logs.
            pass
        fields = context.get('operationFields', {})
        if context.get('contextSchemaVersion') == 2 and all(typ in fields for typ in requested):
            contracts = context['contracts']
            data = {
                **context,
                'schema': {'oneOf': contracts['anyOf'], '$defs': contracts['$defs']},
            }
        else:
            envelope = json.loads(invoke(str(binary), ['schema', '--json'], logs, 'schema'))
            if not envelope.get('ok'):
                raise ValueError('Schema command returned an unsuccessful envelope')
            data = envelope['data']
        validate_data(data, version)
        write_json(snapshot_path, {'identity': identity, 'data': data, 'collectedAt': datetime.now(timezone.utc).isoformat()})
    commands = command_map(data['schema'])
    present = [typ for typ in requested if typ in commands]
    missing = [typ for typ in requested if typ not in commands]
    sliced = slice_schema(data['schema'], [commands[typ] for typ in present])
    selection_key = hashlib.sha256(json.dumps([key, args.scenario, args.format, requested]).encode()).hexdigest()[:16]
    contract_path = cache / (selection_key + '.contract.json')
    write_json(contract_path, {'metadata': {k: data[k] for k in ['cliVersion', 'protocolVersion', 'edition']}, 'schema': sliced})
    summary = {'ok': True, 'scenario': args.scenario, 'format': args.format, 'metadata': {k: data[k] for k in ['cliVersion', 'protocolVersion', 'edition']}, 'cacheHit': hit, 'contextFingerprint': key, 'snapshot': str(snapshot_path), 'contract': str(contract_path), 'workflow': str(SKILL / scenario['path']), 'requiredModules': [str(SKILL / file) for file in scenario['requiredModules']], 'schemaTypesPresent': present, 'schemaTypesMissing': missing, 'workspaceState': 'not queried; obtain current status/inventory before a mutation', 'environment': 'not probed; no browser or installation launched', 'processLogs': str(logs)}
    summary['requiredTypesMissing'] = [typ for typ in required_types if typ not in commands]
    summary['extraTypesMissing'] = [typ for typ in args.types if typ not in commands and typ not in required_types]
    summary['contractReady'] = not summary['requiredTypesMissing']
    summary['operationFields'] = operation_fields(commands, present)
    if data.get('contextSchemaVersion') == 2:
        for index, typ in enumerate(present):
            summary['operationFields'][typ] = {
                **data['operationFields'][typ], 'contract': f'#/schema/oneOf/{index}'
            }
        summary['capabilityFingerprint'] = data['capabilityFingerprint']
    write_json(cache / (selection_key + '.context.json'), summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
