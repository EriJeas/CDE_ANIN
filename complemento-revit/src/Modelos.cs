// Complemento de Revit "Publicar al CDE" (CDE ANIN). Los datos que viajan entre el complemento y el servidor del CDE.
using System.Collections.Generic;
using System.Runtime.Serialization;

namespace CdeAnin
{
    [DataContract] public class Configuracion
    {
        [DataMember(Name = "servidor")] public string Servidor { get; set; }
        [DataMember(Name = "llave")] public string Llave { get; set; }
        [DataMember(Name = "ultimoProyecto")] public string UltimoProyecto { get; set; }
        [DataMember(Name = "detalle")] public string Detalle { get; set; }   // geometria: "bajo" | "medio" | "alto" (ViewDetailLevel)
        // solo el complemento de Navisworks: minutos como maximo para la publicacion y si el acero de refuerzo se dibuja ("incluir")
        [DataMember(Name = "minutos", EmitDefaultValue = false)] public int? Minutos { get; set; }
        [DataMember(Name = "acero", EmitDefaultValue = false)] public string Acero { get; set; }
    }
    [DataContract] public class Proyecto
    {
        [DataMember(Name = "id")] public string Id { get; set; }
        [DataMember(Name = "codigo")] public string Codigo { get; set; }
        [DataMember(Name = "nombre")] public string Nombre { get; set; }
        public override string ToString() => Codigo + " - " + Nombre;
    }
    [DataContract] public class RespuestaProyectos { [DataMember(Name = "proyectos")] public List<Proyecto> Proyectos { get; set; } [DataMember(Name = "servidor")] public string Servidor { get; set; } }
    [DataContract] public class Validacion
    {
        [DataMember(Name = "ok")] public bool Ok { get; set; }
        [DataMember(Name = "errores")] public List<string> Errores { get; set; }
        [DataMember(Name = "base")] public string Base { get; set; }
        [DataMember(Name = "revision")] public string Revision { get; set; }
        [DataMember(Name = "tipo")] public string Tipo { get; set; }
    }
    [DataContract] public class RespuestaSubida
    {
        [DataMember(Name = "ok")] public bool Ok { get; set; }
        [DataMember(Name = "contenedor")] public string Contenedor { get; set; }
        [DataMember(Name = "version")] public string Version { get; set; }
        [DataMember(Name = "n")] public int N { get; set; }
        [DataMember(Name = "revision")] public string Revision { get; set; }
        [DataMember(Name = "estado")] public string Estado { get; set; }
    }
    [DataContract] public class RespuestaInicio { [DataMember(Name = "subida")] public string Subida { get; set; } }
    [DataContract] public class RespuestaEstado { [DataMember(Name = "estado")] public string Estado { get; set; } [DataMember(Name = "error")] public string Error { get; set; } }
    [DataContract] public class ElementoIncidencia
    {
        [DataMember(Name = "modelo")] public string Modelo { get; set; }
        [DataMember(Name = "uid")] public string Uid { get; set; }
        [DataMember(Name = "ifcGuid")] public string IfcGuid { get; set; }
        [DataMember(Name = "e")] public long E { get; set; }
    }
    [DataContract] public class Camara
    {
        [DataMember(Name = "pos")] public double[] Pos { get; set; }
        [DataMember(Name = "dir")] public double[] Dir { get; set; }
        [DataMember(Name = "up")] public double[] Up { get; set; }
        [DataMember(Name = "fov")] public double Fov { get; set; }
    }
    [DataContract] public class Incidencia
    {
        [DataMember(Name = "id")] public string Id { get; set; }
        [DataMember(Name = "numero")] public int Numero { get; set; }
        [DataMember(Name = "titulo")] public string Titulo { get; set; }
        [DataMember(Name = "estado")] public string Estado { get; set; }
        [DataMember(Name = "prioridad")] public string Prioridad { get; set; }
        [DataMember(Name = "autor")] public string Autor { get; set; }
        [DataMember(Name = "elementos")] public List<ElementoIncidencia> Elementos { get; set; }
        [DataMember(Name = "camara")] public Camara Camara { get; set; }
        public override string ToString() => "#" + Numero + "  " + Titulo + "  [" + Estado + ", " + Prioridad + "]";
    }
    [DataContract] public class RespuestaIncidencias { [DataMember(Name = "incidencias")] public List<Incidencia> Incidencias { get; set; } }
    [DataContract] public class NuevaIncidencia
    {
        [DataMember(Name = "titulo")] public string Titulo { get; set; }
        [DataMember(Name = "descripcion")] public string Descripcion { get; set; }
        [DataMember(Name = "prioridad")] public string Prioridad { get; set; }
        [DataMember(Name = "version_id")] public string VersionId { get; set; }
        [DataMember(Name = "elementos")] public List<ElementoIncidencia> Elementos { get; set; }
        [DataMember(Name = "camara")] public Camara Camara { get; set; }
    }
}
