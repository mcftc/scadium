{{/* Chart name (overridable). */}}
{{- define "scadium.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fully-qualified release name. */}}
{{- define "scadium.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "scadium.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{/* Common labels. */}}
{{- define "scadium.labels" -}}
app.kubernetes.io/name: {{ include "scadium.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: scadium
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end -}}

{{/* Per-component selector labels. Usage: include "scadium.selectorLabels" (dict "ctx" . "component" "api") */}}
{{- define "scadium.selectorLabels" -}}
app.kubernetes.io/name: {{ include "scadium.name" .ctx }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* The secret name to mount (existing or chart-managed). */}}
{{- define "scadium.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "scadium.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/* Fully-qualified image ref for a component image name. */}}
{{- define "scadium.image" -}}
{{- printf "%s/%s:%s" .ctx.Values.image.registry .image .ctx.Values.image.tag -}}
{{- end -}}

{{/* In-cluster host for a component service. */}}
{{- define "scadium.svcHost" -}}
{{- printf "%s-%s" (include "scadium.fullname" .ctx) .component -}}
{{- end -}}
