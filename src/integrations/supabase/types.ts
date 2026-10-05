export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admins: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          full_name: string | null
          role: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          role?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          changed_by_email: string | null
          changes: Json | null
          id: number
          patient_id: string | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          changes?: Json | null
          id?: number
          patient_id?: string | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          changes?: Json | null
          id?: number
          patient_id?: string | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          reminder_sent_at: string | null
          reminder_sent_by: string | null
          reminder_channel: string | null
          attendance: string | null
          created_by_email: string | null
          duration_minutes: number
          practice_number: number | null
          practice_registered_at: string | null
          modality: string
          appointment_date: string
          appointment_time: string
          consultation_type: Database["public"]["Enums"]["consultation_type"]
          created_at: string
          id: string
          patient_id: string | null
          professional_id: string | null
          reason: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          reminder_sent_at?: string | null
          reminder_sent_by?: string | null
          reminder_channel?: string | null
          attendance?: string | null
          created_by_email?: string | null
          duration_minutes?: number
          practice_number?: number | null
          practice_registered_at?: string | null
          modality?: string
          appointment_date: string
          appointment_time: string
          consultation_type: Database["public"]["Enums"]["consultation_type"]
          created_at?: string
          id?: string
          patient_id?: string | null
          professional_id?: string | null
          reason: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          reminder_sent_at?: string | null
          reminder_sent_by?: string | null
          reminder_channel?: string | null
          attendance?: string | null
          created_by_email?: string | null
          duration_minutes?: number
          practice_number?: number | null
          practice_registered_at?: string | null
          modality?: string
          appointment_date?: string
          appointment_time?: string
          consultation_type?: Database["public"]["Enums"]["consultation_type"]
          created_at?: string
          id?: string
          patient_id?: string | null
          professional_id?: string | null
          reason?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_requests: {
        Row: {
          age: number
          created_at: string
          dni: string
          email: string | null
          first_name: string
          guardian_name: string | null
          id: string
          last_name: string
          locality: string | null
          notes: string | null
          patient_id: string | null
          patient_type: Database["public"]["Enums"]["patient_type"]
          phone: string
          preferred_modality: string
          reason: string
          referred_by: string | null
          status: string
          updated_at: string
          workshop_attended: boolean | null
          workshop_id: string | null
        }
        Insert: {
          age: number
          created_at?: string
          dni: string
          email?: string | null
          first_name: string
          guardian_name?: string | null
          id?: string
          last_name: string
          locality?: string | null
          notes?: string | null
          patient_id?: string | null
          patient_type: Database["public"]["Enums"]["patient_type"]
          phone: string
          preferred_modality?: string
          reason: string
          referred_by?: string | null
          status?: string
          updated_at?: string
          workshop_attended?: boolean | null
          workshop_id?: string | null
        }
        Update: {
          age?: number
          created_at?: string
          dni?: string
          email?: string | null
          first_name?: string
          guardian_name?: string | null
          id?: string
          last_name?: string
          locality?: string | null
          notes?: string | null
          patient_id?: string | null
          patient_type?: Database["public"]["Enums"]["patient_type"]
          phone?: string
          preferred_modality?: string
          reason?: string
          referred_by?: string | null
          status?: string
          updated_at?: string
          workshop_attended?: boolean | null
          workshop_id?: string | null
        }
        Relationships: []
      }
      patient_followups: {
        Row: {
          appointment_id: string | null
          voided_at: string | null
          voided_by: string | null
          void_reason: string | null
          author_email: string | null
          created_at: string
          id: string
          note: string
          note_date: string
          patient_id: string
        }
        Insert: {
          appointment_id?: string | null
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
          author_email?: string | null
          created_at?: string
          id?: string
          note: string
          note_date?: string
          patient_id: string
        }
        Update: {
          appointment_id?: string | null
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
          author_email?: string | null
          created_at?: string
          id?: string
          note?: string
          note_date?: string
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_followups_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_referrals: {
        Row: {
          voided_at: string | null
          voided_by: string | null
          void_reason: string | null
          created_at: string
          created_by: string | null
          destination: string | null
          id: string
          kind: string
          outcome: string | null
          patient_id: string
          reason: string | null
          registered: boolean
          referral_date: string
          specialty: string
          status: string
          updated_at: string
        }
        Insert: {
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          id?: string
          kind: string
          outcome?: string | null
          patient_id: string
          reason?: string | null
          registered?: boolean
          referral_date?: string
          specialty: string
          status?: string
          updated_at?: string
        }
        Update: {
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          id?: string
          kind?: string
          outcome?: string | null
          patient_id?: string
          reason?: string | null
          registered?: boolean
          referral_date?: string
          specialty?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_referrals_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_reports: {
        Row: {
          voided_at: string | null
          voided_by: string | null
          void_reason: string | null
          author_email: string | null
          created_at: string
          diagnosis: string | null
          id: string
          patient_id: string
          professional_id: string | null
          progress: string | null
          report_date: string
          therapy_evolution: string | null
          updated_at: string
        }
        Insert: {
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
          author_email?: string | null
          created_at?: string
          diagnosis?: string | null
          id?: string
          patient_id: string
          professional_id?: string | null
          progress?: string | null
          report_date?: string
          therapy_evolution?: string | null
          updated_at?: string
        }
        Update: {
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
          author_email?: string | null
          created_at?: string
          diagnosis?: string | null
          id?: string
          patient_id?: string
          professional_id?: string | null
          progress?: string | null
          report_date?: string
          therapy_evolution?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_reports_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_reports_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          birth_date: string | null
          address: string | null
          school_shift: string | null
          school_grade: string | null
          lives_with: string | null
          siblings: string | null
          main_caregiver: string | null
          parents_dedication: string | null
          arrival_route: string | null
          stutter_onset_age: string | null
          stutter_onset_form: string | null
          stutter_situations: string | null
          previous_treatments: string | null
          family_history: string | null
          diagnosis_code: string | null
          consent_date: string | null
          discharge_date: string | null
          discharge_notes: string | null
          avoids_speaking: boolean | null
          frustration_communicating: boolean | null
          consent_signed: boolean
          therapy_modes: string[]
          case_status: Database["public"]["Enums"]["case_status"]
          cud_status: string | null
          guardian_name: string | null
          guardian_phone: string | null
          has_health_insurance: boolean | null
          health_insurance: string | null
          is_medicated: boolean
          main_diagnosis: string | null
          medication: string | null
          other_conditions: string[]
          professional_id: string | null
          referred_by: string | null
          school: string | null
          age: number
          created_at: string
          dni: string
          email: string | null
          first_name: string
          id: string
          last_name: string
          locality: string | null
          notes: string | null
          patient_type: Database["public"]["Enums"]["patient_type"]
          phone: string
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          address?: string | null
          school_shift?: string | null
          school_grade?: string | null
          lives_with?: string | null
          siblings?: string | null
          main_caregiver?: string | null
          parents_dedication?: string | null
          arrival_route?: string | null
          stutter_onset_age?: string | null
          stutter_onset_form?: string | null
          stutter_situations?: string | null
          previous_treatments?: string | null
          family_history?: string | null
          diagnosis_code?: string | null
          consent_date?: string | null
          discharge_date?: string | null
          discharge_notes?: string | null
          avoids_speaking?: boolean | null
          frustration_communicating?: boolean | null
          consent_signed?: boolean
          locality?: string | null
          therapy_modes?: string[]
          case_status?: Database["public"]["Enums"]["case_status"]
          cud_status?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          has_health_insurance?: boolean | null
          health_insurance?: string | null
          is_medicated?: boolean
          main_diagnosis?: string | null
          medication?: string | null
          other_conditions?: string[]
          professional_id?: string | null
          referred_by?: string | null
          school?: string | null
          age: number
          created_at?: string
          dni: string
          email?: string | null
          first_name: string
          id?: string
          last_name: string
          notes?: string | null
          patient_type: Database["public"]["Enums"]["patient_type"]
          phone: string
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          address?: string | null
          school_shift?: string | null
          school_grade?: string | null
          lives_with?: string | null
          siblings?: string | null
          main_caregiver?: string | null
          parents_dedication?: string | null
          arrival_route?: string | null
          stutter_onset_age?: string | null
          stutter_onset_form?: string | null
          stutter_situations?: string | null
          previous_treatments?: string | null
          family_history?: string | null
          diagnosis_code?: string | null
          consent_date?: string | null
          discharge_date?: string | null
          discharge_notes?: string | null
          avoids_speaking?: boolean | null
          frustration_communicating?: boolean | null
          consent_signed?: boolean
          locality?: string | null
          therapy_modes?: string[]
          case_status?: Database["public"]["Enums"]["case_status"]
          cud_status?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          has_health_insurance?: boolean | null
          health_insurance?: string | null
          is_medicated?: boolean
          main_diagnosis?: string | null
          medication?: string | null
          other_conditions?: string[]
          professional_id?: string | null
          referred_by?: string | null
          school?: string | null
          age?: number
          created_at?: string
          dni?: string
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string
          notes?: string | null
          patient_type?: Database["public"]["Enums"]["patient_type"]
          phone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      professionals: {
        Row: {
          session_minutes: number
          active: boolean
          license: string | null
          show_on_site: boolean
          user_id: string | null
          created_at: string
          days: string | null
          description: string | null
          id: string
          name: string
          photo_url: string | null
          specialty: string
        }
        Insert: {
          session_minutes?: number
          active?: boolean
          license?: string | null
          show_on_site?: boolean
          user_id?: string | null
          created_at?: string
          days: string | null
          description: string | null
          id?: string
          name: string
          photo_url?: string | null
          specialty: string
        }
        Update: {
          session_minutes?: number
          active?: boolean
          license?: string | null
          show_on_site?: boolean
          user_id?: string | null
          created_at?: string
          days?: string | null
          description?: string | null
          id?: string
          name?: string
          photo_url?: string | null
          specialty?: string
        }
        Relationships: []
      }
      satisfaction_surveys: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          rating_attention: number
          rating_communication: number
          rating_overall: number
          rating_treatment: number
          respondent: string
          would_recommend: boolean
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          rating_attention: number
          rating_communication: number
          rating_overall: number
          rating_treatment: number
          respondent: string
          would_recommend: boolean
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          rating_attention?: number
          rating_communication?: number
          rating_overall?: number
          rating_treatment?: number
          respondent?: string
          would_recommend?: boolean
        }
        Relationships: []
      }
      schedule_blocks: {
        Row: {
          active: boolean
          block_date: string
          created_at: string
          created_by_email: string | null
          end_time: string | null
          id: string
          professional_id: string | null
          reason: string
          start_time: string | null
        }
        Insert: {
          active?: boolean
          block_date: string
          created_at?: string
          created_by_email?: string | null
          end_time?: string | null
          id?: string
          professional_id?: string | null
          reason: string
          start_time?: string | null
        }
        Update: {
          active?: boolean
          block_date?: string
          created_at?: string
          created_by_email?: string | null
          end_time?: string | null
          id?: string
          professional_id?: string | null
          reason?: string
          start_time?: string | null
        }
        Relationships: []
      }
      social_corner_items: {
        Row: {
          category: string
          created_at: string
          created_by_email: string | null
          description: string
          featured: boolean
          id: string
          image_url: string | null
          link_label: string | null
          link_url: string | null
          published: boolean
          slug: string | null
          sort_order: number
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by_email?: string | null
          description: string
          featured?: boolean
          id?: string
          image_url?: string | null
          link_label?: string | null
          link_url?: string | null
          published?: boolean
          slug?: string | null
          sort_order?: number
          subtitle?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by_email?: string | null
          description?: string
          featured?: boolean
          id?: string
          image_url?: string | null
          link_label?: string | null
          link_url?: string | null
          published?: boolean
          slug?: string | null
          sort_order?: number
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      workshops: {
        Row: {
          canceled: boolean
          capacity: number | null
          created_at: string
          id: string
          notes: string | null
          place: string
          start_time: string
          workshop_date: string
        }
        Insert: {
          canceled?: boolean
          capacity?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          place?: string
          start_time?: string
          workshop_date: string
        }
        Update: {
          canceled?: boolean
          capacity?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          place?: string
          start_time?: string
          workshop_date?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_staff: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_upcoming_workshops: {
        Args: Record<PropertyKey, never>
        Returns: { workshop_date: string; start_time: string; place: string }[]
      }
      get_public_team: {
        Args: Record<PropertyKey, never>
        Returns: {
          name: string
          specialty: string
          description: string | null
          photo_url: string | null
        }[]
      }
      get_booked_slots: {
        Args: { p_start: string; p_end: string }
        Returns: {
          appointment_date: string
          appointment_time: string
          status: Database["public"]["Enums"]["appointment_status"]
        }[]
      }
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_clinical: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_director: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      request_appointment: {
        Args: {
          p_first_name: string
          p_last_name: string
          p_dni: string
          p_age: number
          p_phone: string
          p_email: string | null
          p_patient_type: Database["public"]["Enums"]["patient_type"]
          p_consultation_type: Database["public"]["Enums"]["consultation_type"]
          p_reason: string
          p_date: string
          p_time: string
          p_modality?: string
          p_locality?: string | null
        }
        Returns: string
      }
      submit_satisfaction_survey: {
        Args: {
          p_respondent: string
          p_rating_attention: number
          p_rating_communication: number
          p_rating_treatment: number
          p_rating_overall: number
          p_would_recommend: boolean
          p_comment: string | null
        }
        Returns: string
      }
      submit_intake_request: {
        Args: {
          p_first_name: string
          p_last_name: string
          p_dni: string
          p_age: number
          p_patient_type: Database["public"]["Enums"]["patient_type"]
          p_phone: string
          p_email: string | null
          p_guardian_name: string | null
          p_locality: string | null
          p_preferred_modality: string
          p_referred_by: string | null
          p_reason: string
        }
        Returns: string
      }
      staff_role: {
        Args: Record<PropertyKey, never>
        Returns: string | null
      }
    }
    Enums: {
      appointment_status: "pendiente" | "confirmado" | "cancelado"
      case_status: "en_evaluacion" | "en_tratamiento" | "derivado" | "alta" | "abandono"
      consultation_type: "primera_vez" | "seguimiento"
      patient_type: "niño" | "adolescente" | "adulto"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      appointment_status: ["pendiente", "confirmado", "cancelado"],
      case_status: ["en_evaluacion", "en_tratamiento", "derivado", "alta", "abandono"],
      consultation_type: ["primera_vez", "seguimiento"],
      patient_type: ["niño", "adolescente", "adulto"],
    },
  },
} as const
